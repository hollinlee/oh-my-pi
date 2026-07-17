import assert from "node:assert/strict";
import { access, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireMineruJobLock, createMineruJob, mineruJobFromId, MINERU_RESULT_TTL_MS, sweepExpiredMineruJobs } from "./jobs.ts";

async function envFixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-jobs-"));
  return { stateDir, env: { PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv };
}

test("job IDs are canonical and reject traversal", async () => {
  const { env } = await envFixture();
  const job = await createMineruJob(env);
  assert.equal(mineruJobFromId(job.jobId, env).dir, job.dir);
  assert.throws(() => mineruJobFromId("../../escape", env), /Invalid MinerU job ID/);
});

test("job lock rejects concurrent owners and makes TTL sweep skip active jobs", async () => {
  const { env } = await envFixture();
  const job = await createMineruJob(env);
  const oldTime = new Date(Date.now() - MINERU_RESULT_TTL_MS - 1000);
  await utimes(job.dir, oldTime, oldTime);
  const lock = await acquireMineruJobLock(job);
  await assert.rejects(acquireMineruJobLock(job), /already active/);
  const sweep = await sweepExpiredMineruJobs(env, Date.now());
  assert.equal(sweep.removed, 0);
  await access(job.dir);
  await lock.release();
});

test("TTL sweep removes only expired job directories", async () => {
  const { env } = await envFixture();
  const oldJob = await createMineruJob(env);
  const freshJob = await createMineruJob(env);
  const now = Date.now();
  const oldTime = new Date(now - MINERU_RESULT_TTL_MS - 1000);
  await utimes(oldJob.dir, oldTime, oldTime);

  const result = await sweepExpiredMineruJobs(env, now);
  assert.equal(result.removed, 1);
  assert.deepEqual(result.warnings, []);
  await assert.rejects(access(oldJob.dir), /ENOENT/);
  await access(freshJob.dir);
});
