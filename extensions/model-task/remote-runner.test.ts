import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import {
  REMOTE_EXPERIMENT_SCHEMA_VERSION,
  RemoteExperimentCheckpointSchema,
  RemoteExperimentResultSchema,
  type RemoteExperiment,
} from "./remote-schemas.ts";
import { RemoteExperimentRunner, RemoteExperimentStore, type RemoteExecResponse } from "./remote-runner.ts";

function experiment(id: string, commands: RemoteExperiment["commands"] = [{ id: "test", command: "make test", idempotent: true }]): RemoteExperiment {
  return {
    schemaVersion: REMOTE_EXPERIMENT_SCHEMA_VERSION,
    id,
    deviceId: "compiler-server",
    user: "lhl",
    workdir: "/work/model-task",
    allowedCommandPatterns: ["^make test$", "^echo ", "^dangerous", "^reboot"],
    commands,
    taskTimeoutSeconds: 30,
    commandTimeoutSeconds: 2,
    maxRetries: 2,
    cleanup: ["rm -f test-artifact"],
    resourceLimits: { cpu: "2", memory: "4G" },
  };
}

function response(overrides: Partial<RemoteExecResponse> = {}): RemoteExecResponse {
  return { exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 5, ...overrides };
}

test("remote experiment schema requires explicit limits and validates checkpoint results", () => {
  const value = experiment("schema");
  assert.equal(Value.Check(RemoteExperimentResultSchema, { status: "succeeded", records: [], cleanup: value.cleanup }), true);
  assert.equal(Value.Check(RemoteExperimentCheckpointSchema, {
    schemaVersion: REMOTE_EXPERIMENT_SCHEMA_VERSION,
    revision: 0,
    experiment: value,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nextCommandIndex: 0,
    records: [],
  }), true);
});

test("runner requires an explicit device id, command allowlist, and resource limits", async () => {
  let calls = 0;
  const runner = new RemoteExperimentRunner(async () => { calls += 1; return response(); });
  const blocked = await runner.run({ ...experiment("policy"), deviceId: "compiler-server" });
  assert.equal(blocked.status, "succeeded");
  assert.equal(calls, 1);
  const denied = await runner.run({ ...experiment("denied"), commands: [{ id: "bad", command: "curl https://example.test", idempotent: true }] });
  assert.equal(denied.status, "blocked");
  assert.equal(calls, 1);
  await assert.rejects(
    runner.run({ ...experiment("no-limit"), resourceLimits: {} }),
    /resourceLimits/,
  );
});

test("runner persists command records and resumes from checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "remote-experiment-"));
  const store = new RemoteExperimentStore(root);
  let calls = 0;
  const runner = new RemoteExperimentRunner(async () => { calls += 1; return response(); }, undefined, store);
  const value = await runner.run(experiment("persist"));
  assert.equal(value.status, "succeeded");
  assert.equal(value.records[0].deviceId, "compiler-server");
  assert.equal(value.cleanup[0], "rm -f test-artifact");
  assert.equal(calls, 1);
  assert.equal((await stat(store.pathFor("persist"))).mode & 0o777, 0o600);
  const resumed = await runner.run(experiment("persist"));
  assert.equal(resumed.status, "succeeded");
  assert.equal(calls, 1);
});

test("runner retries only idempotent commands and reports timeout side effects", async () => {
  let attempts = 0;
  const retrying = new RemoteExperimentRunner(async () => {
    attempts += 1;
    return attempts < 2 ? response({ exitCode: 1 }) : response();
  });
  const succeeded = await retrying.run(experiment("retry", [{ id: "test", command: "make test", idempotent: true }]));
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.records.length, 2);

  let unsafeAttempts = 0;
  const unsafe = new RemoteExperimentRunner(async () => {
    unsafeAttempts += 1;
    return response({ exitCode: null, timedOut: true, durationMs: 10 });
  });
  const review = await unsafe.run(experiment("unsafe", [{ id: "mutate", command: "dangerous mutate", idempotent: false }]));
  assert.equal(review.status, "needs_review");
  assert.equal(unsafeAttempts, 1);
});

test("high-risk commands require approval and interrupted non-idempotent checkpoints stay blocked", async () => {
  let calls = 0;
  const denied = new RemoteExperimentRunner(async () => { calls += 1; return response(); });
  const blocked = await denied.run(experiment("approval", [{ id: "reboot", command: "reboot now", idempotent: false }]));
  assert.equal(blocked.status, "blocked");
  assert.equal(calls, 0);

  let approvedCalls = 0;
  let dangerousFlag = false;
  const approved = new RemoteExperimentRunner(async (request) => {
    approvedCalls += 1;
    dangerousFlag = request.allowDangerous;
    return response();
  }, async () => true);
  const allowed = await approved.run(experiment("approval-ok", [{ id: "reboot", command: "reboot now", idempotent: false }]));
  assert.equal(allowed.status, "succeeded");
  assert.equal(approvedCalls, 1);
  assert.equal(dangerousFlag, true);

  const root = await mkdtemp(path.join(os.tmpdir(), "remote-experiment-"));
  const store = new RemoteExperimentStore(root);
  const pending = experiment("interrupted", [{ id: "mutate", command: "dangerous mutate", idempotent: false }]);
  await store.save({
    schemaVersion: REMOTE_EXPERIMENT_SCHEMA_VERSION,
    revision: 0,
    experiment: pending,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nextCommandIndex: 0,
    activeCommand: { id: "mutate", idempotent: false },
    records: [],
  });
  const resumed = await new RemoteExperimentRunner(async () => { calls += 1; return response(); }, async () => true, store).run(pending);
  assert.equal(resumed.status, "needs_review");
  assert.equal(calls, 0);
});

test("concurrent runs for one experiment share one remote execution", async () => {
  let calls = 0;
  const runner = new RemoteExperimentRunner(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return response();
  });
  const value = experiment("concurrent");
  const [first, second] = await Promise.all([runner.run(value), runner.run(value)]);
  assert.equal(calls, 1);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "succeeded");
});
