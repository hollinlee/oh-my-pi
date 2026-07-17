import { access, rm } from "node:fs/promises";
import { DEFAULT_PREVIEW_CHARS, materializeMineruMarkdown, readPreview } from "./archive.ts";
import { MineruApiError, MineruHttpClient, type MineruFetch, type MineruRemoteResult } from "./client.ts";
import { getMineruStatus, resolveMineruToken } from "./config.ts";
import { isMineruImageExtension, validateMineruInput, type ValidatedMineruInput } from "./input.ts";
import {
  createMineruJob,
  mineruJobFromId,
  mineruRetentionUntil,
  readMineruManifest,
  writeMineruManifest,
  type MineruJob,
} from "./jobs.ts";
import type {
  MineruFailureCategory,
  MineruJobManifest,
  MineruParseParams,
  MineruParseResult,
} from "./schemas.ts";

export type MineruParseDependencies = {
  fetch?: MineruFetch;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  random?: () => number;
  remove?: (path: string, options: { force?: boolean; recursive?: boolean }) => Promise<void>;
  onState?: (state: string) => void;
};

class MineruDeadlineError extends Error {
  readonly timeoutSeconds: number;

  constructor(timeoutSeconds: number) {
    super(`MinerU local time budget of ${timeoutSeconds} seconds expired.`);
    this.name = "MineruDeadlineError";
    this.timeoutSeconds = timeoutSeconds;
  }
}

function clampWaitSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return 600;
  return Math.min(Math.max(Math.floor(value as number), 1), 1800);
}

function totalSignal(parent: AbortSignal | undefined, timeoutSeconds: number): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let deadlineExpired = false;
  const onAbort = () => controller.abort(parent?.reason ?? new Error("MinerU parsing cancelled."));
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    deadlineExpired = true;
    controller.abort(new MineruDeadlineError(timeoutSeconds));
  }, timeoutSeconds * 1000);
  return {
    signal: controller.signal,
    timedOut: () => deadlineExpired,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error("MinerU parsing cancelled.");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), ms);
    const onAbort = () => finish(() => reject(signal.reason ?? new Error("MinerU parsing cancelled.")));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function temporaryError(error: unknown): boolean {
  if (error instanceof MineruApiError) {
    if (error.status === 429 || (error.status != null && error.status >= 500)) return true;
    if (["REQUEST_TIMEOUT", "UPLOAD_FAILED", "DOWNLOAD_FAILED", "-60001", "-60007", "-60009"].includes(error.code ?? "")) return true;
  }
  return error instanceof TypeError;
}

function safeSubmitRetry(error: unknown): boolean {
  if (!(error instanceof MineruApiError)) return false;
  if (error.code === "REQUEST_TIMEOUT") return false;
  return error.status === 429
    || (error.status != null && error.status >= 500)
    || ["-60001", "-60007", "-60009"].includes(error.code ?? "");
}

async function withRetries<T>(
  operation: () => Promise<T>,
  options: { signal: AbortSignal; submit: boolean; random: () => number; onRetry?: (attempt: number, delayMs: number) => void },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (options.signal.aborted) throw options.signal.reason ?? new Error("MinerU parsing cancelled.");
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = options.submit ? safeSubmitRetry(error) : temporaryError(error);
      if (!retryable || attempt >= 3 || options.signal.aborted) throw error;
      const retryAfter = error instanceof MineruApiError ? error.retryAfterMs : undefined;
      const delayMs = retryAfter ?? Math.round(500 * 2 ** (attempt - 1) * (0.75 + options.random() * 0.5));
      options.onRetry?.(attempt + 1, delayMs);
      await sleep(delayMs, options.signal);
    }
  }
  throw lastError;
}

function classifyFailure(error: unknown, timedOut: boolean, cancelled: boolean): { category: MineruFailureCategory; code?: string; traceId?: string; retryable: boolean; suggestedAction: string } {
  if (timedOut || error instanceof MineruDeadlineError) {
    return { category: "timeout", code: "LOCAL_TIMEOUT", retryable: true, suggestedAction: "Resume the existing MinerU job by job_id." };
  }
  if (cancelled) {
    return { category: "cancelled", code: "LOCAL_CANCELLED", retryable: true, suggestedAction: "Resume the existing MinerU job by job_id if needed." };
  }
  if (error instanceof MineruApiError) {
    const code = error.code;
    if (["A0202", "A0211"].includes(code ?? "")) return { category: "auth", code, traceId: error.traceId, retryable: false, suggestedAction: "Refresh the MinerU token with /mineru setup." };
    if (["-60018", "-60019"].includes(code ?? "")) return { category: "quota", code, traceId: error.traceId, retryable: false, suggestedAction: "Wait for the MinerU quota window to reset." };
    if (error.status === 429) return { category: "rate-limit", code, traceId: error.traceId, retryable: true, suggestedAction: "Retry the same job later." };
    if (["UNSAFE_RESULT", "UNSAFE_RESPONSE"].includes(code ?? "")) return { category: "unsafe-result", code, traceId: error.traceId, retryable: false, suggestedAction: "Do not use this result; inspect the upstream archive contract." };
    if (["-500", "-10002", "-60002", "-60003", "-60004", "-60005", "-60006", "INPUT_CHANGED"].includes(code ?? "")) return { category: "input", code, traceId: error.traceId, retryable: false, suggestedAction: "Correct or replace the input document." };
    return { category: "service", code, traceId: error.traceId, retryable: temporaryError(error), suggestedAction: temporaryError(error) ? "Retry the same job later." : "Inspect the MinerU error and trace ID." };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/token|not authorized|authorization/i.test(message)) {
    return { category: "auth", retryable: false, suggestedAction: "Configure and authorize MinerU with /mineru setup." };
  }
  if (/input|file|signature|extension|credential|regular|empty|200 MB|job ID/i.test(message)) {
    return { category: "input", retryable: false, suggestedAction: "Correct the input path or document." };
  }
  if (/ZIP|full\.md|archive|symlink|entry/i.test(message)) {
    return { category: "unsafe-result", retryable: false, suggestedAction: "Do not use this result; inspect the archive." };
  }
  return { category: "service", retryable: false, suggestedAction: "Inspect the error before retrying." };
}

function failedResult(
  error: unknown,
  context: {
    status: "failed" | "timed-out-local" | "cancelled-local";
    stage: string;
    job?: MineruJob;
    manifest?: MineruJobManifest;
    timedOut: boolean;
    cancelled: boolean;
    remoteMayContinue: boolean;
  },
): MineruParseResult {
  const classified = classifyFailure(error, context.timedOut, context.cancelled);
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: context.status,
    stage: context.stage,
    category: classified.category,
    retryable: classified.retryable,
    code: classified.code,
    traceId: classified.traceId ?? context.manifest?.traceId,
    error: message,
    jobId: context.job?.jobId,
    batchId: context.manifest?.batchId,
    state: context.manifest?.state,
    model: context.manifest?.model,
    ocr: context.manifest?.ocr,
    language: context.manifest?.language,
    remoteMayContinue: context.remoteMayContinue,
    suggestedAction: classified.suggestedAction,
  };
}

async function pollUntilDone(
  client: MineruHttpClient,
  batchId: string,
  signal: AbortSignal,
  random: () => number,
  onState?: (state: string) => void,
): Promise<MineruRemoteResult> {
  let interval = 2000;
  while (true) {
    const remote = await withRetries(() => client.getBatch(batchId, signal), { signal, submit: false, random });
    onState?.(remote.state);
    if (remote.state === "failed") throw new MineruApiError(remote.error || "MinerU extraction failed.", remote.errorCode || "EXTRACT_FAILED", remote.traceId);
    if (remote.state === "done") {
      if (!remote.zipUrl) throw new MineruApiError("MinerU completed without full_zip_url.", "INVALID_SCHEMA", remote.traceId);
      return remote;
    }
    await sleep(Math.round(interval * (0.9 + random() * 0.2)), signal);
    interval = Math.min(interval * 2, 30_000);
  }
}

async function readyFromManifest(job: MineruJob, manifest: MineruJobManifest): Promise<MineruParseResult | undefined> {
  if (manifest.state !== "ready" || !manifest.resultPath) return undefined;
  try {
    await access(manifest.resultPath);
  } catch {
    return undefined;
  }
  return {
    status: "ready",
    jobId: job.jobId,
    batchId: manifest.batchId,
    state: "ready",
    model: manifest.model,
    ocr: manifest.ocr,
    language: manifest.language,
    resultPath: manifest.resultPath,
    characters: manifest.characters,
    preview: (await readPreview(manifest.resultPath)).slice(0, DEFAULT_PREVIEW_CHARS),
    retentionUntil: mineruRetentionUntil(new Date(manifest.updatedAt).getTime()),
    traceId: manifest.traceId,
    remoteMayContinue: false,
  };
}

export async function parseWithMineru(
  params: MineruParseParams,
  parentSignal?: AbortSignal,
  dependencies: MineruParseDependencies = {},
): Promise<MineruParseResult> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const random = dependencies.random ?? Math.random;
  const remove = dependencies.remove ?? rm;
  const maxWaitSeconds = clampWaitSeconds(params.max_wait_seconds);
  const deadline = totalSignal(parentSignal, maxWaitSeconds);
  let stage = "validating";
  let job: MineruJob | undefined;
  let manifest: MineruJobManifest | undefined;
  let input: ValidatedMineruInput | undefined;
  let ambiguousSubmit = false;

  const setStage = (next: string) => {
    stage = next;
    dependencies.onState?.(next);
  };

  try {
    const status = await getMineruStatus({ env });
    if (status.disabled) throw new Error("MinerU is disabled by OH_MY_PI_MINERU_DISABLED=1.");
    if (!status.authorized) throw new Error("MinerU cloud upload is not authorized. Run /mineru setup.");
    const resolvedToken = await resolveMineruToken({ env });
    if (!resolvedToken.token) throw new Error("MinerU token is not configured. Run /mineru setup or set MINERU_TOKEN.");
    if (Boolean(params.path) === Boolean(params.job_id)) throw new Error("Provide exactly one of path or job_id.");

    const client = new MineruHttpClient(resolvedToken.token, dependencies.baseUrl, dependencies.fetch);

    if (params.job_id) {
      job = mineruJobFromId(params.job_id, env);
      manifest = await readMineruManifest(job);
      const ready = await readyFromManifest(job, manifest);
      if (ready) return ready;
      setStage("polling");
    } else {
      setStage("validating");
      input = await validateMineruInput(params.path!);
      const model = params.model ?? "vlm";
      const ocr = params.ocr ?? isMineruImageExtension(input.extension);
      const language = params.language?.trim() || "ch";
      job = await createMineruJob(env);

      setStage("requesting-upload");
      let submission;
      try {
        submission = await withRetries(
          () => client.requestUpload(input!, { model, ocr, language }, deadline.signal),
          { signal: deadline.signal, submit: true, random, onRetry: (_attempt, delay) => dependencies.onState?.(`requesting-upload retry in ${delay}ms`) },
        );
      } catch (error) {
        ambiguousSubmit = error instanceof TypeError || (error instanceof MineruApiError && error.code === "REQUEST_TIMEOUT");
        throw error;
      }
      manifest = {
        version: 1,
        jobId: job.jobId,
        batchId: submission.batchId,
        sourcePath: input.path,
        filename: input.filename,
        model,
        ocr,
        language,
        state: "uploading",
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
        traceId: submission.traceId,
      };
      await writeMineruManifest(job, manifest);

      setStage("uploading");
      await withRetries(() => client.uploadFile(submission.uploadUrl, input!.handle, input!.size, deadline.signal), {
        signal: deadline.signal,
        submit: false,
        random,
        onRetry: (_attempt, delay) => dependencies.onState?.(`uploading retry in ${delay}ms`),
      });
      manifest = { ...manifest, state: "pending", updatedAt: now().toISOString() };
      await writeMineruManifest(job, manifest);
      await input.handle.close();
      input = undefined;
      setStage("polling");
    }

    const remote = await pollUntilDone(client, manifest!.batchId, deadline.signal, random, (state) => {
      dependencies.onState?.(`polling: ${state}`);
    });
    manifest = { ...manifest!, state: remote.state, updatedAt: now().toISOString(), traceId: remote.traceId ?? manifest!.traceId };
    await writeMineruManifest(job!, manifest);

    setStage("downloading");
    await withRetries(() => client.downloadZip(remote.zipUrl!, job!.zipPath, deadline.signal), {
      signal: deadline.signal,
      submit: false,
      random,
      onRetry: (_attempt, delay) => dependencies.onState?.(`downloading retry in ${delay}ms`),
    });

    setStage("materializing");
    const markdown = await materializeMineruMarkdown(job!.zipPath, job!.dir, undefined, deadline.signal);
    let cleanupWarning: string | undefined;
    try {
      await remove(job!.zipPath, { force: true });
    } catch (error) {
      cleanupWarning = `MinerU cleanup warning: ${(error as Error).message}`;
    }
    manifest = { ...manifest, state: "ready", updatedAt: now().toISOString(), resultPath: markdown.resultPath, characters: markdown.characters };
    await writeMineruManifest(job!, manifest);
    setStage("ready");

    return {
      status: "ready",
      jobId: job!.jobId,
      batchId: manifest.batchId,
      state: "ready",
      model: manifest.model,
      ocr: manifest.ocr,
      language: manifest.language,
      resultPath: markdown.resultPath,
      characters: markdown.characters,
      preview: markdown.preview,
      retentionUntil: mineruRetentionUntil(now().getTime()),
      traceId: manifest.traceId,
      remoteMayContinue: false,
      warning: cleanupWarning,
    };
  } catch (error) {
    const timedOut = deadline.timedOut() || error instanceof MineruDeadlineError;
    const cancelled = !timedOut && Boolean(parentSignal?.aborted || (deadline.signal.aborted && !deadline.timedOut()));
    const terminalStatus = timedOut ? "timed-out-local" : cancelled ? "cancelled-local" : "failed";
    const remoteMayContinue = ambiguousSubmit || Boolean(
      manifest?.batchId
      && !["done", "ready", "failed"].includes(manifest.state)
      && !(error instanceof MineruApiError && ["EXTRACT_FAILED", "-60010"].includes(error.code ?? "")),
    );
    if (job) await remove(job.zipPath, { force: true }).catch(() => undefined);
    if (job && manifest) {
      manifest = {
        ...manifest,
        state: terminalStatus,
        updatedAt: now().toISOString(),
        errorCode: error instanceof MineruApiError ? error.code : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        traceId: error instanceof MineruApiError ? error.traceId ?? manifest.traceId : manifest.traceId,
      };
      await writeMineruManifest(job, manifest).catch(() => undefined);
    } else if (job) {
      await remove(job.dir, { recursive: true, force: true }).catch(() => undefined);
    }
    return failedResult(error, { status: terminalStatus, stage, job, manifest, timedOut, cancelled, remoteMayContinue });
  } finally {
    await input?.handle.close().catch(() => undefined);
    deadline.cleanup();
  }
}
