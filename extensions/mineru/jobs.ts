import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mineruStateDir } from "./config.ts";
import type { MineruJobManifest } from "./schemas.ts";

export const MINERU_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export type MineruJob = {
  jobId: string;
  dir: string;
  zipPath: string;
  manifestPath: string;
  resultPath: string;
  lockPath: string;
};

export type MineruJobLock = {
  release: () => Promise<void>;
};

function jobPaths(jobId: string, env: NodeJS.ProcessEnv): MineruJob {
  const dir = join(mineruStateDir(env), "jobs", jobId);
  return {
    jobId,
    dir,
    zipPath: join(dir, "result.zip"),
    manifestPath: join(dir, "manifest.json"),
    resultPath: join(dir, "full.md"),
    lockPath: join(dir, ".lock"),
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

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

async function staleLock(job: MineruJob): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(job.lockPath, "utf8")) as { pid?: number };
    return typeof owner.pid === "number" && !processIsAlive(owner.pid);
  } catch {
    const info = await stat(job.lockPath).catch(() => undefined);
    return Boolean(info && Date.now() - info.mtimeMs > 5000);
  }
}

export async function acquireMineruJobLock(job: MineruJob, retryStale = true): Promise<MineruJobLock> {
  let handle;
  try {
    handle = await open(job.lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if ((error as { code?: string }).code !== "EEXIST") {
      await rm(job.lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (retryStale && await staleLock(job)) {
      await rm(job.lockPath, { force: true });
      return acquireMineruJobLock(job, false);
    }
    throw new Error(`MinerU job is already active: ${job.jobId}`);
  }
  return {
    release: async () => {
      await rm(job.lockPath, { force: true });
    },
  };
}

export async function writeMineruManifest(job: MineruJob, manifest: MineruJobManifest): Promise<void> {
  const temporary = `${job.manifestPath}.${process.pid}.${randomUUID()}.tmp`;
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
  if (
    item.version !== 1
    || item.jobId !== job.jobId
    || typeof item.batchId !== "string"
    || item.batchId.length === 0
    || (item.resultPath != null && resolve(item.resultPath) !== resolve(job.resultPath))
  ) {
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
    let lock: MineruJobLock | undefined;
    try {
      const candidateInfo = await stat(job.manifestPath).catch(() => stat(job.dir));
      lock = await acquireMineruJobLock(job);
      const info = await stat(job.manifestPath).catch(() => candidateInfo);
      if (now - info.mtimeMs < MINERU_RESULT_TTL_MS) {
        await lock.release();
        lock = undefined;
        continue;
      }
      const tombstone = `${job.dir}.deleting-${randomUUID()}`;
      await rename(job.dir, tombstone);
      lock = undefined;
      await rm(tombstone, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      if (/already active/.test((error as Error).message)) continue;
      warnings.push(`${entry.name}: ${(error as Error).message}`);
    } finally {
      await lock?.release().catch(() => undefined);
    }
  }
  return { removed, warnings };
}

export function mineruRetentionUntil(now = Date.now()): string {
  return new Date(now + MINERU_RESULT_TTL_MS).toISOString();
}
