import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { StringEnum } from "@earendil-works/pi-ai"
import { Type } from "typebox"

const TAVILY_SEARCH_TOOL = "tavily_search"
const TAVILY_EXTRACT_TOOL = "tavily_extract"
const TAVILY_API_BASE = "https://api.tavily.com"
const TAVILY_KEYCHAIN_SERVICE = "pi-tool-api-key-tavily"

const DEFAULT_POOL_MAX_CONCURRENCY = 6
const DEFAULT_POOL_PER_KEY_CONCURRENCY = 2
const DEFAULT_POOL_COOLDOWN_MS = 60_000
const DEFAULT_KEYCHAIN_AUTO_DISCOVER_LIMIT = 20

type TavilyPayload = Record<string, unknown>
type TavilyPath = "/search" | "/extract"

type TavilyKeyState = {
  key: string
  id: string
  active: number
  requests: number
  failures: number
  lastUsedAt?: number
  cooldownUntil?: number
  exhaustedUntil?: number
  disabledReason?: string
}

type TavilyPool = {
  signature: string
  keys: TavilyKeyState[]
  active: number
}

let tavilyPool: TavilyPool | undefined

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function splitKeys(raw: string | undefined): string[] {
  return (raw || "")
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean)
}

function readKeychainKey(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined

  const account = process.env.USER || process.env.LOGNAME
  if (!account) return undefined

  try {
    const key = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return key || undefined
  } catch {
    return undefined
  }
}

function defaultKeychainServices(): string[] {
  const base = process.env.TAVILY_KEYCHAIN_SERVICE || TAVILY_KEYCHAIN_SERVICE
  const limit = readNonNegativeIntEnv("TAVILY_KEYCHAIN_AUTO_DISCOVER_LIMIT", DEFAULT_KEYCHAIN_AUTO_DISCOVER_LIMIT)
  const services = [base]
  for (let index = 2; index <= limit; index += 1) {
    services.push(`${base}-${index}`)
  }
  return services
}

function readTavilyApiKeys(): string[] {
  const keys: string[] = []
  keys.push(...splitKeys(process.env.TAVILY_API_KEYS))

  const envKey = process.env.TAVILY_API_KEY?.trim()
  if (envKey) keys.push(envKey)

  const keychainServices = [
    ...splitKeys(process.env.TAVILY_KEYCHAIN_SERVICES),
    ...defaultKeychainServices(),
  ]

  for (const service of [...new Set(keychainServices)]) {
    const key = readKeychainKey(service)
    if (key) keys.push(key)
  }

  return [...new Set(keys)]
}

function keyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 10)
}

function getTavilyPool(): TavilyPool {
  const keys = readTavilyApiKeys()
  const signature = keys.map(keyId).join(",")
  if (tavilyPool && tavilyPool.signature === signature) return tavilyPool

  tavilyPool = {
    signature,
    active: 0,
    keys: keys.map((key) => ({
      key,
      id: keyId(key),
      active: 0,
      requests: 0,
      failures: 0,
    })),
  }
  return tavilyPool
}

function nextMonthStartMs(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
}

function abortError(): Error {
  const error = new Error("Tavily request aborted")
  error.name = "AbortError"
  return error
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })
}

function classifyTavilyFailure(status: number, detail: string): "quota" | "rate-limit" | "auth" | "retryable" | "fatal" {
  const lower = detail.toLowerCase()
  if (status === 401 || status === 403) return "auth"
  if (lower.includes("monthly") || lower.includes("quota") || lower.includes("usage limit") || lower.includes("exceeded limit")) return "quota"
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) return "rate-limit"
  if (status >= 500) return "retryable"
  return "fatal"
}

function isTavilyKeyPotentiallyAvailable(key: TavilyKeyState, now: number): boolean {
  return !key.disabledReason && !(key.exhaustedUntil && key.exhaustedUntil > now)
}

function isTavilyKeyEligible(key: TavilyKeyState, now: number, perKeyConcurrency: number): boolean {
  if (!isTavilyKeyPotentiallyAvailable(key, now)) return false
  if (key.cooldownUntil && key.cooldownUntil > now) return false
  if (key.active >= perKeyConcurrency) return false
  return true
}

function selectTavilyKey(pool: TavilyPool, perKeyConcurrency: number): TavilyKeyState | undefined {
  const now = Date.now()
  let selectedKey: TavilyKeyState | undefined
  let eligibleCount = 0

  for (const key of pool.keys) {
    if (!isTavilyKeyEligible(key, now, perKeyConcurrency)) continue

    eligibleCount += 1
    // Reservoir sampling keeps each eligible key equally likely without allocating a candidate array.
    if (Math.random() < 1 / eligibleCount) selectedKey = key
  }

  return selectedKey
}

function hasPotentiallyAvailableKey(pool: TavilyPool): boolean {
  const now = Date.now()
  return pool.keys.some((key) => isTavilyKeyPotentiallyAvailable(key, now))
}

async function acquireTavilyKey(signal?: AbortSignal): Promise<{ pool: TavilyPool; key: TavilyKeyState }> {
  const pool = getTavilyPool()
  if (!pool.keys.length) {
    throw new Error(
      `Tavily API key is not configured. Set TAVILY_API_KEYS, TAVILY_API_KEY, TAVILY_KEYCHAIN_SERVICES, or store it in macOS Keychain service ${TAVILY_KEYCHAIN_SERVICE}.`
    )
  }

  const maxConcurrency = readIntEnv("TAVILY_POOL_MAX_CONCURRENCY", DEFAULT_POOL_MAX_CONCURRENCY)
  const perKeyConcurrency = readIntEnv("TAVILY_POOL_PER_KEY_CONCURRENCY", DEFAULT_POOL_PER_KEY_CONCURRENCY)

  while (true) {
    if (signal?.aborted) throw abortError()
    if (pool.active < maxConcurrency) {
      const key = selectTavilyKey(pool, perKeyConcurrency)
      if (key) {
        pool.active += 1
        key.active += 1
        key.requests += 1
        key.lastUsedAt = Date.now()
        return { pool, key }
      }
    }

    if (!hasPotentiallyAvailableKey(pool)) {
      throw new Error("No Tavily API keys are currently available. All keys are disabled or monthly quota exhausted.")
    }

    await sleep(100, signal)
  }
}

function releaseTavilyKey(pool: TavilyPool, key: TavilyKeyState) {
  pool.active = Math.max(0, pool.active - 1)
  key.active = Math.max(0, key.active - 1)
}

function tavilyPoolStats() {
  const pool = getTavilyPool()
  const now = Date.now()
  return {
    active: pool.active,
    keys: pool.keys.map((key) => ({
      id: key.id,
      active: key.active,
      requests: key.requests,
      failures: key.failures,
      lastUsedAt: key.lastUsedAt,
      status: key.disabledReason
        ? "disabled"
        : key.exhaustedUntil && key.exhaustedUntil > now
          ? "quota-exhausted"
          : key.cooldownUntil && key.cooldownUntil > now
            ? "cooldown"
            : "ready",
      retryAt: key.exhaustedUntil && key.exhaustedUntil > now ? key.exhaustedUntil : key.cooldownUntil,
      disabledReason: key.disabledReason,
    })),
  }
}

async function callTavily(path: TavilyPath, payload: TavilyPayload, signal?: AbortSignal): Promise<unknown> {
  const pool = getTavilyPool()
  const maxAttempts = Math.max(pool.keys.length, 1)
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const acquired = await acquireTavilyKey(signal)
    const { key } = acquired

    try {
      const response = await fetch(`${TAVILY_API_BASE}${path}`, {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${key.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const text = await response.text()
      let data: unknown = text
      if (text.trim()) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }

      if (response.ok) return data

      const detail = typeof data === "string" ? data : JSON.stringify(data)
      const failure = classifyTavilyFailure(response.status, detail)
      key.failures += 1

      if (failure === "quota") {
        key.exhaustedUntil = nextMonthStartMs()
        lastError = new Error(`Tavily key ${key.id} quota exhausted: ${detail}`)
        continue
      }

      if (failure === "rate-limit" || failure === "retryable") {
        key.cooldownUntil = Date.now() + readIntEnv("TAVILY_POOL_COOLDOWN_MS", DEFAULT_POOL_COOLDOWN_MS)
        lastError = new Error(`Tavily key ${key.id} temporarily unavailable (${response.status}): ${detail}`)
        continue
      }

      if (failure === "auth") {
        key.disabledReason = `auth failed: ${response.status}`
        lastError = new Error(`Tavily key ${key.id} auth failed: ${detail}`)
        continue
      }

      throw new Error(`Tavily ${path} failed (${response.status}): ${detail}`)
    } catch (error) {
      if (signal?.aborted) throw error
      key.failures += 1
      key.cooldownUntil = Date.now() + readIntEnv("TAVILY_POOL_COOLDOWN_MS", DEFAULT_POOL_COOLDOWN_MS)
      lastError = error
    } finally {
      releaseTavilyKey(acquired.pool, key)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function truncate(value: string, limit = 1600): string {
  return value.length > limit ? `${value.slice(0, limit)}\n... truncated` : value
}

function formatTavilySearchResult(data: unknown): string {
  const root = asRecord(data)
  const lines: string[] = []
  const answer = optionalString(root.answer)
  if (answer) lines.push(`Answer:\n${answer}`)

  const results = asArray(root.results)
  if (!results.length) {
    lines.push(`No Tavily results returned. Raw response:\n${truncate(JSON.stringify(data, null, 2), 4000)}`)
    return lines.join("\n\n")
  }

  lines.push(results.map((item, index) => {
    const record = asRecord(item)
    const title = optionalString(record.title) || "Untitled"
    const url = optionalString(record.url) || "unknown URL"
    const content = optionalString(record.content) || optionalString(record.raw_content) || ""
    const score = typeof record.score === "number" ? `\nScore: ${record.score}` : ""
    return `[${index + 1}] ${title}\nURL: ${url}${score}${content ? `\n${truncate(content)}` : ""}`
  }).join("\n\n"))

  return lines.join("\n\n")
}

function formatTavilyExtractResult(data: unknown): string {
  const root = asRecord(data)
  const results = asArray(root.results)
  if (!results.length) return `No Tavily extract results returned. Raw response:\n${truncate(JSON.stringify(data, null, 2), 4000)}`

  return results.map((item, index) => {
    const record = asRecord(item)
    const url = optionalString(record.url) || `result ${index + 1}`
    const content = optionalString(record.raw_content) || optionalString(record.content) || ""
    return `[${index + 1}] ${url}\n${truncate(content, 5000)}`
  }).join("\n\n")
}

function tavilyErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text" as const, text: message }],
    details: { error: message, pool: tavilyPoolStats() },
  }
}

function enableTavilyTools(pi: ExtensionAPI) {
  const active = new Set(pi.getActiveTools())
  active.add(TAVILY_SEARCH_TOOL)
  active.add(TAVILY_EXTRACT_TOOL)
  pi.setActiveTools([...active])
}

export function showTavilyPoolStatus(ctx: ExtensionCommandContext) {
  const stats = tavilyPoolStats()
  const ready = stats.keys.filter((key) => key.status === "ready").length
  ctx.ui.notify(`Tavily pool: ${ready}/${stats.keys.length} keys ready, active requests: ${stats.active}`, "info")
}

export default function tavilyTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: TAVILY_SEARCH_TOOL,
    label: "Tavily Search",
    description: "Search the web using Tavily and return structured, citation-friendly results. Uses a pool of Tavily API keys when multiple keys are configured.",
    promptSnippet: "Search the web for current external information",
    promptGuidelines: [
      "Use tavily_search when the user asks for current web information, recent events, external documentation, or facts that may have changed since training.",
      "Do not use tavily_search for private local repository facts that can be answered with read, grep, or find.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      max_results: Type.Optional(Type.Number({ description: "Maximum number of results to return. Defaults to 5." })),
      search_depth: Type.Optional(StringEnum(["basic", "advanced"] as const, { description: "Tavily search depth. Defaults to basic." })),
      include_answer: Type.Optional(Type.Boolean({ description: "Whether Tavily should include a generated answer. Defaults to false." })),
      include_raw_content: Type.Optional(Type.Boolean({ description: "Whether to include raw page content when available. Defaults to false." })),
      include_domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict search to these domains." })),
      exclude_domains: Type.Optional(Type.Array(Type.String(), { description: "Exclude search results from these domains." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({ content: [{ type: "text", text: `Searching Tavily for: ${params.query}` }], details: { pool: tavilyPoolStats() } })
        const data = await callTavily("/search", {
          query: params.query,
          max_results: Math.min(Math.max(Math.floor(params.max_results ?? 5), 1), 20),
          search_depth: params.search_depth ?? "basic",
          include_answer: params.include_answer ?? false,
          include_raw_content: params.include_raw_content ?? false,
          include_domains: params.include_domains,
          exclude_domains: params.exclude_domains,
        }, signal)
        return {
          content: [{ type: "text", text: formatTavilySearchResult(data) }],
          details: { response: data, pool: tavilyPoolStats() },
        }
      } catch (error) {
        return tavilyErrorResult(error)
      }
    },
  })

  pi.registerTool({
    name: TAVILY_EXTRACT_TOOL,
    label: "Tavily Extract",
    description: "Extract readable content from one or more web pages using Tavily. Uses a pool of Tavily API keys when multiple keys are configured.",
    promptSnippet: "Extract readable content from web page URLs",
    promptGuidelines: [
      "Use tavily_extract when tavily_search returns a relevant URL and the page text is needed before answering.",
      "Use tavily_extract only for public web URLs, not local files or private repository paths.",
    ],
    parameters: Type.Object({
      urls: Type.Array(Type.String({ description: "Public web page URL." }), { description: "URLs to extract." }),
      include_images: Type.Optional(Type.Boolean({ description: "Whether to include image references. Defaults to false." })),
      extract_depth: Type.Optional(StringEnum(["basic", "advanced"] as const, { description: "Tavily extraction depth. Defaults to basic." })),
    }),
    prepareArguments(args) {
      const record = asRecord(args)
      if (typeof record.url === "string" && !Array.isArray(record.urls)) {
        return { ...record, urls: [record.url] } as never
      }
      return args as never
    },
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({ content: [{ type: "text", text: `Extracting ${params.urls.length} URL(s) with Tavily` }], details: { pool: tavilyPoolStats() } })
        const data = await callTavily("/extract", {
          urls: params.urls,
          include_images: params.include_images ?? false,
          extract_depth: params.extract_depth ?? "basic",
        }, signal)
        return {
          content: [{ type: "text", text: formatTavilyExtractResult(data) }],
          details: { response: data, pool: tavilyPoolStats() },
        }
      } catch (error) {
        return tavilyErrorResult(error)
      }
    },
  })

  pi.registerCommand("tavily-pool-status", {
    description: "Show Tavily API key pool status without revealing API keys",
    handler: async (_args, ctx) => {
      showTavilyPoolStatus(ctx)
    },
  })

  pi.on("session_start", () => {
    enableTavilyTools(pi)
  })
}
