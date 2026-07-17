import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
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

export async function createMineruJob(env: NodeJS.ProcessEnv = process.env): Promise<MineruJob> {
  const jobId = randomUUID();
  const dir = join(mineruStateDir(env), "jobs", jobId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return {
    jobId,
    dir,
    zipPath: join(dir, "result.zip"),
    manifestPath: join(dir, "manifest.json"),
    resultPath: join(dir, "full.md"),
  };
}

export async function writeMineruManifest(job: MineruJob, manifest: MineruJobManifest): Promise<void> {
  const temporary = `${job.manifestPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, job.manifestPath);
}

export function mineruRetentionUntil(now = Date.now()): string {
  return new Date(now + MINERU_RESULT_TTL_MS).toISOString();
}
