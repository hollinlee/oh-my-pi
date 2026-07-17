import { rm } from "node:fs/promises";
import { materializeMineruMarkdown } from "./archive.ts";
import { MineruApiError, MineruHttpClient, type MineruFetch } from "./client.ts";
import { getMineruStatus, resolveMineruToken } from "./config.ts";
import { isMineruImageExtension, validateMineruInput } from "./input.ts";
import { createMineruJob, mineruRetentionUntil, writeMineruManifest } from "./jobs.ts";
import type { MineruJobManifest, MineruParseParams, MineruParseResult } from "./schemas.ts";

export type MineruParseDependencies = {
  fetch?: MineruFetch;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  onState?: (state: string) => void;
};

function clampWaitSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return 600;
  return Math.min(Math.max(Math.floor(value as number), 1), 1800);
}

export async function parseWithMineru(
  params: MineruParseParams,
  signal?: AbortSignal,
  dependencies: MineruParseDependencies = {},
): Promise<MineruParseResult> {
  const env = dependencies.env ?? process.env;
  const status = await getMineruStatus({ env });
  if (status.disabled) throw new Error("MinerU is disabled by OH_MY_PI_MINERU_DISABLED=1.");
  if (!status.authorized) throw new Error("MinerU cloud upload is not authorized. Run /mineru setup.");
  const resolvedToken = await resolveMineruToken({ env });
  if (!resolvedToken.token) throw new Error("MinerU token is not configured. Run /mineru setup or set MINERU_TOKEN.");

  dependencies.onState?.("validating");
  const input = await validateMineruInput(params.path);
  const model = params.model ?? "vlm";
  const ocr = params.ocr ?? isMineruImageExtension(input.extension);
  const language = params.language?.trim() || "ch";
  const maxWaitSeconds = clampWaitSeconds(params.max_wait_seconds);
  const now = dependencies.now ?? (() => new Date());
  const job = await createMineruJob(env);
  const client = new MineruHttpClient(resolvedToken.token, dependencies.baseUrl, dependencies.fetch);
  let manifest: MineruJobManifest | undefined;

  try {
    dependencies.onState?.("requesting-upload");
    const submission = await client.requestUpload(input, { model, ocr, language }, signal);
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

    dependencies.onState?.("uploading");
    await client.uploadFile(submission.uploadUrl, input.handle, input.size, signal);
    manifest = { ...manifest, state: "pending", updatedAt: now().toISOString() };
    await writeMineruManifest(job, manifest);

    dependencies.onState?.("polling");
    const remote = await client.waitForBatch(submission.batchId, maxWaitSeconds * 1000, signal);
    manifest = { ...manifest, state: remote.state, updatedAt: now().toISOString(), traceId: remote.traceId ?? manifest.traceId };
    await writeMineruManifest(job, manifest);

    dependencies.onState?.("downloading");
    await client.downloadZip(remote.zipUrl!, job.zipPath, signal);

    dependencies.onState?.("materializing");
    const markdown = await materializeMineruMarkdown(job.zipPath, job.dir);
    await rm(job.zipPath, { force: true });
    manifest = { ...manifest, state: "ready", updatedAt: now().toISOString(), resultPath: markdown.resultPath };
    await writeMineruManifest(job, manifest);
    dependencies.onState?.("ready");

    return {
      status: "ready",
      jobId: job.jobId,
      batchId: submission.batchId,
      state: "ready",
      model,
      ocr,
      language,
      resultPath: markdown.resultPath,
      characters: markdown.characters,
      preview: markdown.preview,
      retentionUntil: mineruRetentionUntil(now().getTime()),
      traceId: remote.traceId ?? submission.traceId,
    };
  } catch (error) {
    await rm(job.zipPath, { force: true });
    if (manifest) {
      await writeMineruManifest(job, {
        ...manifest,
        state: "failed",
        updatedAt: now().toISOString(),
        traceId: error instanceof MineruApiError ? error.traceId ?? manifest.traceId : manifest.traceId,
      }).catch(() => undefined);
    } else {
      await rm(job.dir, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await input.handle.close().catch(() => undefined);
  }
}
