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
  const execute: ExecutionAdapter<string> = async ({ model, onUpdate }) => {
    seen.push(model);
    onUpdate({ phase: "testing", summary: "Tests running" });
    return { status: "succeeded", result: result("done") };
  };
  const harness = new ModelTaskHarness(store, (model) => `${model.provider}/${model.model}`, execute);
  const completed = await harness.run(task("success", {
    execution: { provider: "local", model: "qwen" },
  }));

  assert.deepEqual(seen, ["local/qwen"]);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.activeModel?.model, "qwen");
  assert.deepEqual(completed.result?.models.map((model) => model.model), ["qwen"]);
  assert.ok(completed.events.some((item) => item.summary === "Tests running"));
  assert.equal((await store.load("success"))?.status, "succeeded");
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
    }],
  });
  let calls = 0;
  const harness = new ModelTaskHarness(
    store,
    () => "model",
    async () => { calls += 1; return { status: "succeeded", result: result("done") }; },
  );
  const resumed = await harness.run(spec);
  assert.equal(resumed.status, "needs_review");
  assert.equal(calls, 0);
});
