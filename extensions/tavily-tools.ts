import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { StringEnum } from "@earendil-works/pi-ai"
import { Type } from "typebox"
import { compactToolRenderers } from "./compact-tool-renderer"

const TAVILY_SEARCH_TOOL = "tavily_search"
const TAVILY_EXTRACT_TOOL = "tavily_extract"
const TAVILY_CRAWL_TOOL = "tavily_crawl"
const TAVILY_RESEARCH_TOOL = "tavily_research"
const TAVILY_API_BASE = "https://api.tavily.com"
const TAVILY_KEYCHAIN_SERVICE = "pi-tool-api-key-tavily"

const DEFAULT_POOL_MAX_CONCURRENCY = 6
const DEFAULT_POOL_PER_KEY_CONCURRENCY = 2
const DEFAULT_POOL_COOLDOWN_MS = 60_000
const DEFAULT_KEYCHAIN_AUTO_DISCOVER_LIMIT = 20
const DEFAULT_RESEARCH_POLL_INTERVAL_MS = 2_000
const DEFAULT_RESEARCH_MAX_WAIT_SECONDS = 30
const MAX_CRAWL_LIMIT = 20
const MAX_CRAWL_DEPTH = 3
const MAX_CRAWL_PATTERN_COUNT = 10
const MAX_RESEARCH_WAIT_SECONDS = 90
const MAX_TOOL_OUTPUT_CHARS = 80_000

type TavilyPayload = Record<string, unknown>
type TavilyPath = "/search" | "/extract" | "/crawl" | "/research" | `/research/${string}`
type TavilyMethod = "GET" | "POST"

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

export function tavilyPoolStats() {
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

async function callTavily(path: TavilyPath, payload: TavilyPayload | undefined, signal?: AbortSignal, method: TavilyMethod = "POST"): Promise<unknown> {
  const pool = getTavilyPool()
  const maxAttempts = Math.max(pool.keys.length, 1)
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const acquired = await acquireTavilyKey(signal)
    const { key } = acquired

    try {
      const response = await fetch(`${TAVILY_API_BASE}${path}`, {
        method,
        signal,
        headers: {
          authorization: `Bearer ${key.key}`,
          "content-type": "application/json",
        },
        ...(method === "POST" ? { body: JSON.stringify(payload ?? {}) } : {}),
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

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

function optionalStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(optionalString).filter((item): item is string => Boolean(item)).slice(0, maxItems)
  return items.length ? items : undefined
}

function lenientArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseIPv4Part(part: string): number | undefined {
  const value = part.toLowerCase()
  const radix = value.startsWith("0x") ? 16 : value.length > 1 && value.startsWith("0") ? 8 : 10
  const digits = radix === 16 ? value.slice(2) : value
  const pattern = radix === 16 ? /^[0-9a-f]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/
  if (!digits || !pattern.test(digits)) return undefined
  const parsed = Number.parseInt(digits, radix)
  return Number.isFinite(parsed) ? parsed : undefined
}

function ipv4Bytes(host: string): number[] | undefined {
  const rawParts = host.split(".")
  if (rawParts.length < 1 || rawParts.length > 4) return undefined
  const parts = rawParts.map(parseIPv4Part)
  if (parts.some((part) => part === undefined)) return undefined
  const values = parts as number[]
  if (values.length === 4) return values.every((part) => part >= 0 && part <= 255) ? values : undefined
  if (values.length === 1) {
    const value = values[0]
    if (value < 0 || value > 0xffffffff) return undefined
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
  }
  const first = values[0]
  const second = values[1]
  if (values.length === 2 && first <= 255 && second <= 0xffffff) return [first, (second >>> 16) & 255, (second >>> 8) & 255, second & 255]
  const third = values[2]
  if (values.length === 3 && first <= 255 && second <= 255 && third <= 0xffff) return [first, second, (third >>> 8) & 255, third & 255]
  return undefined
}

function isPrivateIPv4(bytes: number[]): boolean {
  const [a, b] = bytes
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

function isPrivateIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true
  if (host.includes(":")) {
    if (host === "" || host === "::" || host === "::1") return true
    if (host.startsWith("::ffff:")) {
      const mapped = ipv4Bytes(host.slice("::ffff:".length))
      return !mapped || isPrivateIPv4(mapped)
    }
    const firstHextet = host.split(":", 1)[0] || "0"
    if (firstHextet === "0") return true
    if (firstHextet.startsWith("fc") || firstHextet.startsWith("fd")) return true
    if (/^fe[89ab][0-9a-f]{0,2}$/.test(firstHextet)) return true
    return false
  }
  const bytes = ipv4Bytes(host)
  return bytes ? isPrivateIPv4(bytes) : false
}

function publicHttpUrl(value: unknown): string {
  const raw = optionalString(value)
  if (!raw) throw new Error("A public http(s) URL is required.")
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only public http(s) URLs are allowed.")
  if (isPrivateIpLiteral(parsed.hostname)) throw new Error("Private, localhost, and .local URLs are not allowed.")
  parsed.hash = ""
  return parsed.toString()
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

function formatTavilyCrawlResult(data: unknown, perPageLimit: number, totalLimit: number): string {
  const root = asRecord(data)
  const results = lenientArray(root.results)
  if (!results.length) return `No Tavily crawl results returned. Raw response:\n${truncate(JSON.stringify(data, null, 2), 4000)}`

  const lines = results.map((item, index) => {
    const record = asRecord(item)
    const url = optionalString(record.url) || `result ${index + 1}`
    const content = optionalString(record.raw_content) || optionalString(record.content) || ""
    return `[${index + 1}] ${url}\n${truncate(content, perPageLimit)}`
  }).join("\n\n")

  return truncate(lines, totalLimit)
}

function formatTavilyResearchResult(data: unknown, outputLimit: number): string {
  const root = asRecord(data)
  const status = optionalString(root.status)
  const content = optionalString(root.content) || optionalString(root.answer) || optionalString(root.report)
  const sources = lenientArray(root.sources)
    .map((item, index) => {
      const record = asRecord(item)
      const title = optionalString(record.title) || `Source ${index + 1}`
      const url = optionalString(record.url) || "unknown URL"
      return `[${index + 1}] ${title}\nURL: ${url}`
    })
    .join("\n")

  if (content) {
    return truncate(`${status ? `Status: ${status}\n\n` : ""}${content}${sources ? `\n\nSources:\n${sources}` : ""}`, outputLimit)
  }

  return `No Tavily research content returned. Raw response:\n${truncate(JSON.stringify(data, null, 2), outputLimit)}`
}

async function waitForResearch(requestId: string, maxWaitSeconds: number, signal?: AbortSignal, onUpdate?: (result: { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }) => void): Promise<unknown> {
  const deadline = Date.now() + maxWaitSeconds * 1000
  while (Date.now() < deadline) {
    await sleep(Math.min(DEFAULT_RESEARCH_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), signal)
    if (Date.now() >= deadline) break
    const data = await callTavily(`/research/${encodeURIComponent(requestId)}`, undefined, signal, "GET")
    const status = optionalString(asRecord(data).status)
    onUpdate?.({ content: [{ type: "text", text: `Tavily research status: ${status ?? "unknown"}` }], details: { request_id: requestId, status, pool: tavilyPoolStats() } })
    if (status === "completed" || status === "failed") return data
  }
  throw new Error(`Tavily research did not complete within ${maxWaitSeconds}s. Request id: ${requestId}`)
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
  active.add(TAVILY_CRAWL_TOOL)
  active.add(TAVILY_RESEARCH_TOOL)
  pi.setActiveTools([...active])
}

export function showTavilyPoolStatus(ctx: ExtensionCommandContext) {
  const stats = tavilyPoolStats()
  const ready = stats.keys.filter((key) => key.status === "ready").length
  ctx.ui.notify(`Tavily pool: ${ready}/${stats.keys.length} keys ready, active requests: ${stats.active}\nTools: ${TAVILY_SEARCH_TOOL}, ${TAVILY_EXTRACT_TOOL}, ${TAVILY_CRAWL_TOOL}, ${TAVILY_RESEARCH_TOOL}`, "info")
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
    ...compactToolRenderers(TAVILY_SEARCH_TOOL, (args) => args?.query ?? "search"),
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
    ...compactToolRenderers(TAVILY_EXTRACT_TOOL, (args) => `${Array.isArray(args?.urls) ? args.urls.length : 0} URL(s)`),
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

  pi.registerTool({
    name: TAVILY_CRAWL_TOOL,
    label: "Tavily Crawl",
    description: "Crawl public web pages from a root URL using Tavily with bounded depth, page count, and output size. Uses a pool of Tavily API keys when multiple keys are configured.",
    promptSnippet: "Crawl a small public website or documentation section",
    promptGuidelines: [
      "Use tavily_crawl only for public http(s) URLs, not local files, private URLs, or repository paths.",
      "Keep crawl limits small and targeted; use instructions and select/exclude paths to reduce noise.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Public root URL." }),
      instructions: Type.Optional(Type.String({ description: "Natural language crawl instructions." })),
      max_depth: Type.Optional(Type.Number({ description: `Maximum crawl depth. Defaults to 1 and is capped at ${MAX_CRAWL_DEPTH}.` })),
      limit: Type.Optional(Type.Number({ description: `Maximum pages to return. Defaults to 5 and is capped at ${MAX_CRAWL_LIMIT}.` })),
      select_paths: Type.Optional(Type.Array(Type.String(), { description: "Regex path patterns to include. Capped at 10 entries." })),
      exclude_paths: Type.Optional(Type.Array(Type.String(), { description: "Regex path patterns to exclude. Capped at 10 entries." })),
      max_output_chars: Type.Optional(Type.Number({ description: `Maximum characters returned to the model. Capped at ${MAX_TOOL_OUTPUT_CHARS}.` })),
    }),
    ...compactToolRenderers(TAVILY_CRAWL_TOOL, (args) => args?.url ?? "crawl"),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const url = publicHttpUrl(params.url)
        const limit = clampInt(params.limit, 5, 1, MAX_CRAWL_LIMIT)
        const maxDepth = clampInt(params.max_depth, 1, 1, MAX_CRAWL_DEPTH)
        const maxOutputChars = clampInt(params.max_output_chars, 24_000, 1_000, MAX_TOOL_OUTPUT_CHARS)
        onUpdate?.({ content: [{ type: "text", text: `Crawling ${url} with Tavily: depth ${maxDepth}, limit ${limit}` }], details: { pool: tavilyPoolStats() } })
        const data = await callTavily("/crawl", {
          url,
          instructions: optionalString(params.instructions),
          max_depth: maxDepth,
          limit,
          select_paths: optionalStringArray(params.select_paths, MAX_CRAWL_PATTERN_COUNT),
          exclude_paths: optionalStringArray(params.exclude_paths, MAX_CRAWL_PATTERN_COUNT),
        }, signal)
        return {
          content: [{ type: "text", text: formatTavilyCrawlResult(data, Math.ceil(maxOutputChars / limit), maxOutputChars) }],
          details: { response: data, pool: tavilyPoolStats(), limits: { max_depth: maxDepth, limit, max_output_chars: maxOutputChars } },
        }
      } catch (error) {
        return tavilyErrorResult(error)
      }
    },
  })

  pi.registerTool({
    name: TAVILY_RESEARCH_TOOL,
    label: "Tavily Research",
    description: "Create a bounded Tavily research task for a public web question and return the completed report when available. Uses a pool of Tavily API keys when multiple keys are configured.",
    promptSnippet: "Run bounded web research with Tavily when search plus extract is not enough",
    promptGuidelines: [
      "Use tavily_research for bounded public web research only; do not use it for private local repository facts.",
      "Prefer model=mini and short max_wait_seconds unless the user explicitly needs deeper research.",
      "Treat the report as source material, not as a replacement for your own reasoning and citation checks.",
    ],
    parameters: Type.Object({
      input: Type.String({ description: "Research task or question." }),
      model: Type.Optional(StringEnum(["mini", "pro", "auto"] as const, { description: "Research model. Defaults to mini." })),
      max_wait_seconds: Type.Optional(Type.Number({ description: `How long to poll for completion. Defaults to ${DEFAULT_RESEARCH_MAX_WAIT_SECONDS}s and is capped at ${MAX_RESEARCH_WAIT_SECONDS}s.` })),
      max_output_chars: Type.Optional(Type.Number({ description: `Maximum characters returned to the model. Capped at ${MAX_TOOL_OUTPUT_CHARS}.` })),
    }),
    ...compactToolRenderers(TAVILY_RESEARCH_TOOL, (args) => args?.input ?? args?.query ?? "research"),
    prepareArguments(args) {
      const record = asRecord(args)
      if (typeof record.query === "string" && typeof record.input !== "string") {
        return { ...record, input: record.query } as never
      }
      return args as never
    },
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const input = optionalString(params.input)
        if (!input) throw new Error("Research input is required.")
        const maxWaitSeconds = clampInt(params.max_wait_seconds, DEFAULT_RESEARCH_MAX_WAIT_SECONDS, 1, MAX_RESEARCH_WAIT_SECONDS)
        const maxOutputChars = clampInt(params.max_output_chars, 40_000, 1_000, MAX_TOOL_OUTPUT_CHARS)
        onUpdate?.({ content: [{ type: "text", text: `Starting Tavily research: ${input}` }], details: { pool: tavilyPoolStats() } })
        const created = await callTavily("/research", {
          input,
          model: params.model ?? "mini",
          stream: false,
        }, signal)
        const requestId = optionalString(asRecord(created).request_id)
        if (requestId) onUpdate?.({ content: [{ type: "text", text: `Tavily research request id: ${requestId}` }], details: { request_id: requestId, pool: tavilyPoolStats() } })
        if (!requestId) {
          return {
            content: [{ type: "text", text: formatTavilyResearchResult(created, maxOutputChars) }],
            details: { response: created, pool: tavilyPoolStats() },
          }
        }
        const data = await waitForResearch(requestId, maxWaitSeconds, signal, onUpdate)
        return {
          content: [{ type: "text", text: formatTavilyResearchResult(data, maxOutputChars) }],
          details: { response: data, created, pool: tavilyPoolStats(), limits: { max_wait_seconds: maxWaitSeconds, max_output_chars: maxOutputChars } },
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
