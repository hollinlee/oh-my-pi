import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import type { MineruModel } from "./schemas.ts";

const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;
export const MAX_ZIP_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_DOWNLOAD_TIMEOUT_MS = 300_000;

export type MineruFetch = typeof fetch;

export type MineruSubmission = {
  batchId: string;
  uploadUrl: string;
  traceId?: string;
};

export type MineruRemoteResult = {
  batchId: string;
  state: string;
  zipUrl?: string;
  error?: string;
  errorCode?: string;
  traceId?: string;
};

export class MineruApiError extends Error {
  readonly code?: string;
  readonly traceId?: string;
  readonly status?: number;

  constructor(message: string, code?: string, traceId?: string, status?: number) {
    super(message);
    this.name = "MineruApiError";
    this.code = code;
    this.traceId = traceId;
    this.status = status;
  }
}

type ApiEnvelope = {
  code: number | string;
  msg?: string;
  trace_id?: string;
  data?: Record<string, unknown>;
};

function requestSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`MinerU request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new MineruApiError(`MinerU response exceeds ${maxBytes} bytes.`, "UNSAFE_RESPONSE", undefined, response.status);
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function parseEnvelope(text: string, status: number): ApiEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MineruApiError("MinerU returned invalid JSON.", "INVALID_JSON", undefined, status);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MineruApiError("MinerU returned an invalid response envelope.", "INVALID_SCHEMA", undefined, status);
  }
  const envelope = parsed as ApiEnvelope;
  if (typeof envelope.code !== "number" && typeof envelope.code !== "string") {
    throw new MineruApiError("MinerU response is missing code.", "INVALID_SCHEMA", envelope.trace_id, status);
  }
  return envelope;
}

function requireData(envelope: ApiEnvelope): Record<string, unknown> {
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw new MineruApiError("MinerU response is missing data.", "INVALID_SCHEMA", envelope.trace_id);
  }
  return envelope.data;
}

function throwForEnvelope(envelope: ApiEnvelope, status: number): void {
  if (String(envelope.code) === "0") return;
  throw new MineruApiError(envelope.msg || "MinerU API request failed.", String(envelope.code), envelope.trace_id, status);
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("MinerU request aborted.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("MinerU request aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class MineruHttpClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: MineruFetch;

  constructor(token: string, baseUrl = "https://mineru.net/api/v4", fetchImpl: MineruFetch = fetch) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  private async jsonRequest(path: string, init: RequestInit, signal?: AbortSignal): Promise<ApiEnvelope> {
    const timed = requestSignal(signal, DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: timed.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          source: "oh-my-pi",
          ...(init.headers ?? {}),
        },
      });
      const text = await readBoundedText(response, MAX_JSON_RESPONSE_BYTES);
      if (!response.ok) throw new MineruApiError(`MinerU HTTP ${response.status}: ${response.statusText}${text ? ` — ${text}` : ""}`, "HTTP_ERROR", undefined, response.status);
      const envelope = parseEnvelope(text, response.status);
      throwForEnvelope(envelope, response.status);
      return envelope;
    } finally {
      timed.cleanup();
    }
  }

  async requestUpload(
    input: { filename: string },
    options: { model: MineruModel; ocr: boolean; language: string },
    signal?: AbortSignal,
  ): Promise<MineruSubmission> {
    const envelope = await this.jsonRequest("/file-urls/batch", {
      method: "POST",
      body: JSON.stringify({
        files: [{ name: input.filename, is_ocr: options.ocr }],
        model_version: options.model,
        language: options.language,
        enable_formula: true,
        enable_table: true,
      }),
    }, signal);
    const data = requireData(envelope);
    const batchId = typeof data.batch_id === "string" ? data.batch_id : undefined;
    const fileUrls = Array.isArray(data.file_urls) ? data.file_urls : [];
    const uploadUrl = typeof fileUrls[0] === "string" ? fileUrls[0] : undefined;
    if (!batchId || !uploadUrl) throw new MineruApiError("MinerU upload response is missing batch_id or file_urls.", "INVALID_SCHEMA", envelope.trace_id);
    return { batchId, uploadUrl, traceId: envelope.trace_id };
  }

  async uploadFile(url: string, path: string, size: number, signal?: AbortSignal): Promise<void> {
    const timed = requestSignal(signal, UPLOAD_DOWNLOAD_TIMEOUT_MS);
    const stream = createReadStream(path);
    const onAbort = () => stream.destroy(timed.signal.reason instanceof Error ? timed.signal.reason : new Error("MinerU upload aborted."));
    timed.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetchImpl(url, {
        method: "PUT",
        body: stream as unknown as BodyInit,
        headers: { "Content-Length": String(size) },
        signal: timed.signal,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      if (!response.ok) throw new MineruApiError(`MinerU upload failed (${response.status}): ${response.statusText}`, "UPLOAD_FAILED", undefined, response.status);
    } finally {
      timed.signal.removeEventListener("abort", onAbort);
      stream.destroy();
      timed.cleanup();
    }
  }

  async getBatch(batchId: string, signal?: AbortSignal): Promise<MineruRemoteResult> {
    const envelope = await this.jsonRequest(`/extract-results/batch/${encodeURIComponent(batchId)}`, { method: "GET" }, signal);
    const data = requireData(envelope);
    const raw = data.extract_result;
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MineruApiError("MinerU batch response is missing extract_result.", "INVALID_SCHEMA", envelope.trace_id);
    }
    const result = item as Record<string, unknown>;
    const state = typeof result.state === "string" ? result.state : undefined;
    const allowed = new Set(["waiting-file", "uploading", "pending", "running", "converting", "done", "failed"]);
    if (!state || !allowed.has(state)) throw new MineruApiError(`Unknown MinerU task state: ${state ?? "missing"}.`, "INVALID_SCHEMA", envelope.trace_id);
    return {
      batchId,
      state,
      zipUrl: typeof result.full_zip_url === "string" ? result.full_zip_url : undefined,
      error: typeof result.err_msg === "string" ? result.err_msg : undefined,
      errorCode: result.err_code == null ? undefined : String(result.err_code),
      traceId: envelope.trace_id,
    };
  }

  async waitForBatch(batchId: string, maxWaitMs: number, signal?: AbortSignal): Promise<MineruRemoteResult> {
    const deadline = Date.now() + maxWaitMs;
    while (true) {
      const result = await this.getBatch(batchId, signal);
      if (result.state === "failed") throw new MineruApiError(result.error || "MinerU extraction failed.", result.errorCode || "EXTRACT_FAILED", result.traceId);
      if (result.state === "done") {
        if (!result.zipUrl) throw new MineruApiError("MinerU completed without full_zip_url.", "INVALID_SCHEMA", result.traceId);
        return result;
      }
      if (Date.now() >= deadline) throw new MineruApiError(`MinerU task did not complete within ${Math.ceil(maxWaitMs / 1000)} seconds.`, "TIMEOUT", result.traceId);
      await abortableSleep(Math.min(2000, Math.max(0, deadline - Date.now())), signal);
    }
  }

  async downloadZip(url: string, destination: string, signal?: AbortSignal): Promise<number> {
    const timed = requestSignal(signal, UPLOAD_DOWNLOAD_TIMEOUT_MS);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const output = createWriteStream(destination, { mode: 0o600 });
    const onAbort = () => output.destroy(timed.signal.reason instanceof Error ? timed.signal.reason : new Error("MinerU download aborted."));
    timed.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetchImpl(url, { method: "GET", redirect: "follow", signal: timed.signal });
      if (!response.ok || !response.body) throw new MineruApiError(`MinerU result download failed (${response.status}): ${response.statusText}`, "DOWNLOAD_FAILED", undefined, response.status);
      let bytes = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > MAX_ZIP_DOWNLOAD_BYTES) throw new MineruApiError("MinerU result ZIP exceeds the compressed size limit.", "UNSAFE_RESULT");
        if (!output.write(chunk)) await once(output, "drain");
      }
      output.end();
      await once(output, "close");
      return bytes;
    } catch (error) {
      output.destroy();
      throw error;
    } finally {
      timed.signal.removeEventListener("abort", onAbort);
      timed.cleanup();
    }
  }
}
