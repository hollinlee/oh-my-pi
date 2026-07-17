import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mineruStateDir } from "./config.ts";
import type { MineruJobManifest } from "./schemas.ts";

export const MINERU_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export type MineruJob = {
  jobId: string;
  dir: string;
  zipPath: string;
  manifestPath: string;
  resultPath: string;
};

function jobPaths(jobId: string, env: NodeJS.ProcessEnv): MineruJob {
  const dir = join(mineruStateDir(env), "jobs", jobId);
  return {
    jobId,
    dir,
    zipPath: join(dir, "result.zip"),
    manifestPath: join(dir, "manifest.json"),
    resultPath: join(dir, "full.md"),
  };
}

function validJobId(jobId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId);
}

export async function createMineruJob(env: NodeJS.ProcessEnv = process.env): Promise<MineruJob> {
  const job = jobPaths(randomUUID(), env);
  await mkdir(job.dir, { recursive: true, mode: 0o700 });
  await chmod(job.dir, 0o700);
  return job;
}

export function mineruJobFromId(jobId: string, env: NodeJS.ProcessEnv = process.env): MineruJob {
  if (!validJobId(jobId)) throw new Error("Invalid MinerU job ID.");
  return jobPaths(jobId, env);
}

export async function writeMineruManifest(job: MineruJob, manifest: MineruJobManifest): Promise<void> {
  const temporary = `${job.manifestPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, job.manifestPath);
}

export async function readMineruManifest(job: MineruJob): Promise<MineruJobManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(job.manifestPath, "utf8"));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") throw new Error(`MinerU job not found: ${job.jobId}`);
    throw new Error(`Cannot read MinerU job ${job.jobId}: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Invalid MinerU job manifest: ${job.jobId}`);
  const item = parsed as MineruJobManifest;
  if (item.version !== 1 || item.jobId !== job.jobId || typeof item.batchId !== "string") {
    throw new Error(`Invalid MinerU job manifest: ${job.jobId}`);
  }
  return item;
}

export async function sweepExpiredMineruJobs(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<{ removed: number; warnings: string[] }> {
  const jobsDir = join(mineruStateDir(env), "jobs");
  let entries;
  try {
    entries = await readdir(jobsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { removed: 0, warnings: [] };
    return { removed: 0, warnings: [(error as Error).message] };
  }
  let removed = 0;
  const warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validJobId(entry.name)) continue;
    const job = jobPaths(entry.name, env);
    try {
      const info = await stat(job.manifestPath).catch(() => stat(job.dir));
      if (now - info.mtimeMs < MINERU_RESULT_TTL_MS) continue;
      await rm(job.dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      warnings.push(`${entry.name}: ${(error as Error).message}`);
    }
  }
  return { removed, warnings };
}

export function mineruRetentionUntil(now = Date.now()): string {
  return new Date(now + MINERU_RESULT_TTL_MS).toISOString();
}
