import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MODEL_TASK_SCHEMA_VERSION, type TaskResult, type TaskSpec } from "./schemas.ts";
import { ModelTaskHarness, type ExecutionAdapter } from "./harness.ts";
import { TaskCheckpointStore } from "./store.ts";

const now = "2026-01-01T00:00:00.000Z";

function task(id: string, models: TaskSpec["modelConfig"]): TaskSpec {
  return {
    schemaVersion: MODEL_TASK_SCHEMA_VERSION,
    id,
    goal: "Make a bounded change",
    context: [],
    constraints: ["No network"],
    scope: { cwd: "/repo", includePaths: ["src"], excludePaths: [] },
    acceptanceCriteria: ["Tests pass"],
    escalationRules: ["Escalate scope changes"],
    modelConfig: models,
    createdAt: now,
  };
}

function result(summary: string): TaskResult {
  return { summary, models: [], changes: [], verification: [], risks: [], unresolved: [], nextActions: [] };
}

test("harness resolves task execution model and persists successful structured results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const store = new TaskCheckpointStore(root);
  const seen: string[] = [];
  const observed: string[] = [];
  const execute: ExecutionAdapter<string> = async ({ model, onUpdate }) => {
    seen.push(model);
    onUpdate({ phase: "testing", summary: "Tests running" });
    return { status: "succeeded", result: result("done") };
  };
  const harness = new ModelTaskHarness(store, (model) => `${model.provider}/${model.model}`, execute, (checkpoint) => observed.push(`${checkpoint.phase}/${checkpoint.status}`));
  const completed = await harness.run(task("success", {
    execution: { provider: "local", model: "qwen" },
  }));

  assert.deepEqual(seen, ["local/qwen"]);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.activeModel?.model, "qwen");
  assert.deepEqual(completed.result?.models.map((model) => model.model), ["qwen"]);
  assert.ok(completed.events.some((item) => item.summary === "Tests running"));
  assert.ok(observed.includes("testing/running"));
  assert.equal(observed.at(-1), "completed/succeeded");
  assert.equal((await store.load("success"))?.status, "succeeded");
});

test("observer failures cannot fail persisted task execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const store = new TaskCheckpointStore(root);
  const harness = new ModelTaskHarness(
    store,
    () => "model",
    async () => ({ status: "succeeded", result: result("durable") }),
    () => { throw new Error("display failed"); },
  );
  const completed = await harness.run(task("observer-failure", { execution: { provider: "local", model: "coder" } }));
  assert.equal(completed.status, "succeeded");
  assert.equal((await store.load("observer-failure"))?.result?.summary, "durable");
});

test("harness uses only same-role configured fallbacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const attempted: string[] = [];
  const harness = new ModelTaskHarness(
    new TaskCheckpointStore(root),
    (model) => model.model === "primary" ? undefined : model.model,
    async ({ model }) => {
      attempted.push(model);
      return { status: "succeeded", result: result("fallback completed") };
    },
  );
  const completed = await harness.run(task("fallback", {
    execution: {
      provider: "local",
      model: "primary",
      fallbacks: [{ provider: "local", model: "backup" }],
    },
    decision: { provider: "cloud", model: "expensive" },
  }));

  assert.deepEqual(attempted, ["backup"]);
  assert.equal(completed.activeModel?.role, "execution");
  assert.equal(completed.activeModel?.model, "backup");
});

test("harness blocks when execution models are unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const harness = new ModelTaskHarness<string>(
    new TaskCheckpointStore(root),
    () => undefined,
    async () => { throw new Error("should not execute"); },
  );
  const blocked = await harness.run(task("blocked", {
    execution: { provider: "local", model: "missing" },
  }));
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.result?.summary ?? "", /All configured execution models failed/);
});

test("harness returns terminal checkpoints without replaying execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const store = new TaskCheckpointStore(root);
  let calls = 0;
  const harness = new ModelTaskHarness(
    store,
    () => "model",
    async () => { calls += 1; return { status: "succeeded", result: result("done") }; },
  );
  const spec = task("resume", { execution: { provider: "local", model: "qwen" } });
  await harness.run(spec);
  const resumed = await harness.run(spec);
  assert.equal(resumed.status, "succeeded");
  assert.equal(calls, 1);
});

test("interrupted non-idempotent operations require review instead of replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const store = new TaskCheckpointStore(root);
  const spec = task("unsafe-resume", { execution: { provider: "local", model: "qwen" } });
  await store.save({
    schemaVersion: MODEL_TASK_SCHEMA_VERSION,
    revision: 0,
    task: spec,
    status: "running",
    phase: "tool",
    updatedAt: now,
    events: [{
      id: "event-1",
      at: now,
      kind: "tool",
      summary: "External mutation started",
      details: { idempotent: false },
    }, {
      id: "event-2",
      at: now,
      kind: "status",
      summary: "Process interrupted after tool event",
    }],
  });
  let calls = 0;
  const harness = new ModelTaskHarness(
    store,
    () => "model",
    async () => { calls += 1; return { status: "succeeded", result: result("done") }; },
  );
  const resumed = await harness.run(spec);
  const retried = await harness.run(spec);
  assert.equal(resumed.status, "needs_review");
  assert.equal(retried.status, "needs_review");
  assert.equal(calls, 0);
});

test("harness rejects changed task definitions for an existing id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const store = new TaskCheckpointStore(root);
  const harness = new ModelTaskHarness(
    store,
    () => "model",
    async () => ({ status: "succeeded", result: result("done") }),
  );
  const original = task("immutable", { execution: { provider: "local", model: "qwen" } });
  await harness.run(original);
  await assert.rejects(
    harness.run({ ...original, goal: "Different goal" }),
    /task definition mismatch/,
  );
});

test("concurrent runs for one task share a single execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  let calls = 0;
  const harness = new ModelTaskHarness(
    new TaskCheckpointStore(root),
    () => "model",
    async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: "succeeded", result: result("done") };
    },
  );
  const spec = task("concurrent", { execution: { provider: "local", model: "qwen" } });
  const [first, second] = await Promise.all([harness.run(spec), harness.run(spec)]);
  assert.equal(calls, 1);
  assert.equal(first.revision, second.revision);
});

test("checkpoint persistence failures surface without model fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  const store = new TaskCheckpointStore(root);
  let attempts = 0;
  const harness = new ModelTaskHarness(
    store,
    (model) => model.model,
    async ({ onUpdate }) => {
      attempts += 1;
      onUpdate({ phase: "tool", summary: "persist this" });
      return { status: "succeeded", result: result("done") };
    },
  );
  const originalSave = store.save.bind(store);
  let saves = 0;
  store.save = async (...args) => {
    saves += 1;
    if (saves === 4) throw new Error("disk unavailable");
    return originalSave(...args);
  };
  await assert.rejects(harness.run(task("store-failure", {
    execution: { provider: "local", model: "primary", fallbacks: [{ provider: "local", model: "backup" }] },
  })), /disk unavailable/);
  assert.equal(attempts, 1);
});

test("retryable pre-tool model failure uses fallback but thrown execution requires review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-harness-"));
  let attempts = 0;
  const fallbackHarness = new ModelTaskHarness(
    new TaskCheckpointStore(root),
    (model) => model.model,
    async () => {
      attempts += 1;
      if (attempts === 1) return { status: "retryable", result: result("provider unavailable") };
      return { status: "succeeded", result: result("fallback done") };
    },
  );
  const spec = task("retryable", {
    execution: { provider: "local", model: "primary", fallbacks: [{ provider: "local", model: "backup" }] },
  });
  const completed = await fallbackHarness.run(spec);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.activeModel?.model, "backup");

  let unsafeAttempts = 0;
  const unsafeHarness = new ModelTaskHarness(
    new TaskCheckpointStore(root),
    (model) => model.model,
    async () => { unsafeAttempts += 1; throw new Error("unknown completion"); },
  );
  const unsafe = await unsafeHarness.run(task("uncertain", spec.modelConfig));
  assert.equal(unsafe.status, "needs_review");
  assert.equal(unsafeAttempts, 1);
});
