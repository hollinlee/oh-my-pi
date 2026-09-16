import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_TASK_SCHEMA_VERSION, type TaskCheckpoint } from "./schemas.ts";
import { createBestEffortOrcaObserver, isOrcaTaskAdapterEnabled, OrcaTaskAdapter, type OrcaTaskUpdate } from "./orca-adapter.ts";

function checkpoint(model = "executor", status: TaskCheckpoint["status"] = "running"): TaskCheckpoint {
  return {
    schemaVersion: MODEL_TASK_SCHEMA_VERSION,
    revision: 1,
    task: {
      schemaVersion: MODEL_TASK_SCHEMA_VERSION,
      id: "orca-contract",
      goal: "Observe task",
      context: [], constraints: [],
      scope: { cwd: "/repo", includePaths: ["src"], excludePaths: [] },
      acceptanceCriteria: ["observed"], escalationRules: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    status,
    phase: status === "running" ? "execution" : "completed",
    updatedAt: "2026-01-01T00:00:01.000Z",
    activeModel: { provider: "local", model, role: "execution", source: "task" },
    events: [{ id: "1", at: "2026-01-01T00:00:00.000Z", kind: "status", summary: "started" }],
    ...(status === "succeeded" ? { result: { summary: "done", models: [], changes: [], verification: [], risks: [], unresolved: [], nextActions: [] } } : {}),
  };
}

test("Orca adapter is opt-in and preserves protocol scope", async () => {
  assert.equal(isOrcaTaskAdapterEnabled({}), false);
  assert.equal(isOrcaTaskAdapterEnabled({ OH_MY_PI_MODEL_TASK_ORCA_ENABLED: "1" }), true);
  const updates: OrcaTaskUpdate[] = [];
  const adapter = new OrcaTaskAdapter(async (update) => { updates.push(update); });
  await adapter.observe(checkpoint());
  await adapter.observe(checkpoint("advanced"));
  await adapter.observe(checkpoint("advanced", "succeeded"));
  assert.equal(updates[0].session.protocolVersion, MODEL_TASK_SCHEMA_VERSION);
  assert.deepEqual(updates[0].session.scope, checkpoint().task.scope);
  assert.equal(updates[0].model?.name, "executor");
  assert.equal(updates[1].modelChanged, true);
  assert.equal(updates[2].final?.summary, "done");
});

test("best-effort Orca failure never throws into the core harness", async () => {
  const observer = createBestEffortOrcaObserver(new OrcaTaskAdapter(async () => { throw new Error("Orca unavailable"); }));
  assert.doesNotThrow(() => observer(checkpoint()));
  await new Promise((resolve) => setImmediate(resolve));
});
