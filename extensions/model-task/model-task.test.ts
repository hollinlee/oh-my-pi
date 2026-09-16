import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import {
  MODEL_TASK_SCHEMA_VERSION,
  TaskCheckpointSchema,
  TaskSpecSchema,
  type TaskCheckpoint,
} from "./schemas.ts";
import { assertTransition, canTransition, fallbackModels, resolveModel } from "./state.ts";
import { TaskCheckpointStore } from "./store.ts";

function checkpoint(overrides: Partial<TaskCheckpoint> = {}): TaskCheckpoint {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: MODEL_TASK_SCHEMA_VERSION,
    revision: 0,
    task: {
      schemaVersion: MODEL_TASK_SCHEMA_VERSION,
      id: "task-1",
      goal: "Implement the bounded task",
      context: [],
      constraints: ["Do not push"],
      scope: { cwd: "/repo", includePaths: ["src"], excludePaths: [] },
      acceptanceCriteria: ["Tests pass"],
      escalationRules: ["Escalate scope changes"],
      createdAt: now,
    },
    status: "queued",
    phase: "planning",
    updatedAt: now,
    events: [],
    ...overrides,
  };
}

test("task schemas accept version 1 and reject unknown versions", () => {
  const value = checkpoint();
  assert.equal(Value.Check(TaskCheckpointSchema, value), true);
  assert.equal(Value.Check(TaskSpecSchema, value.task), true);
  assert.equal(Value.Check(TaskSpecSchema, { ...value.task, id: "invalid/id" }), false);
  assert.equal(Value.Check(TaskCheckpointSchema, { ...value, schemaVersion: 2 }), false);
});

test("task schemas reject incomplete escalation records", () => {
  const value = checkpoint({
    status: "needs_review",
    escalation: {
      reason: "scope",
      summary: "Public API must change",
      attempted: [],
      evidence: [],
      question: "Approve the API change?",
    },
  });
  assert.equal(Value.Check(TaskCheckpointSchema, value), true);
  assert.equal(Value.Check(TaskCheckpointSchema, {
    ...value,
    escalation: { reason: "scope" },
  }), false);
});

test("checkpoint schema accepts active models and records models in final results", () => {
  const activeModel = {
    provider: "local",
    model: "qwen",
    role: "execution" as const,
    source: "task" as const,
  };
  const value = checkpoint({
    status: "succeeded",
    activeModel,
    result: {
      summary: "done",
      models: [activeModel],
      changes: [],
      verification: [],
      risks: [],
      unresolved: [],
      nextActions: [],
      finalReport: "Completed",
    },
  });
  assert.equal(Value.Check(TaskCheckpointSchema, value), true);
});

test("state machine permits recovery and rejects terminal transitions", () => {
  assert.equal(canTransition("queued", "running"), true);
  assert.equal(canTransition("blocked", "running"), true);
  assert.equal(canTransition("succeeded", "running"), false);
  assert.throws(() => assertTransition("failed", "running"), /Invalid model task status transition/);
});

test("model resolution applies task, project, global precedence and preserves role", () => {
  const resolved = resolveModel("execution", {
    global: { execution: { provider: "local", model: "global" } },
    project: { execution: { provider: "local", model: "project" } },
    task: {
      execution: {
        provider: "local",
        model: "task",
        fallbacks: [{ provider: "backup", model: "task-backup" }],
      },
    },
  });
  assert.deepEqual(resolved, {
    provider: "local",
    model: "task",
    fallbacks: [{ provider: "backup", model: "task-backup" }],
    role: "execution",
    source: "task",
  });
  assert.deepEqual(fallbackModels(resolved!), [{
    provider: "backup",
    model: "task-backup",
    role: "execution",
    source: "task",
  }]);
  assert.equal(resolveModel("review", {}), undefined);
});

test("checkpoint store atomically persists private validated records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-store-"));
  const store = new TaskCheckpointStore(root);
  const value = checkpoint({ revision: 2, status: "running" });
  await store.save(value);

  assert.deepEqual(await store.load("task-1"), value);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(store.pathFor("task-1"))).mode & 0o777, 0o600);
  assert.match(await readFile(store.pathFor("task-1"), "utf8"), /"revision": 2/);
});

test("checkpoint store rejects stale writers and mismatched embedded task ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-store-"));
  const store = new TaskCheckpointStore(root);
  await store.save(checkpoint({ revision: 0 }));
  await store.save(checkpoint({ revision: 1, status: "running" }), 0);
  await assert.rejects(
    store.save(checkpoint({ revision: 2, status: "blocked" }), 0),
    /Stale model task checkpoint/,
  );
  assert.equal((await store.load("task-1"))?.revision, 1);

  await writeFile(path.join(root, "renamed.json"), JSON.stringify({
    ...checkpoint(),
    task: { ...checkpoint().task, id: "task-1" },
  }), { mode: 0o600 });
  await assert.rejects(store.load("renamed"), /checkpoint id mismatch/);
});

test("concurrent saves use unique temporary files and leave no temporary artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-store-"));
  const store = new TaskCheckpointStore(root);
  await Promise.all([
    store.save(checkpoint({ task: { ...checkpoint().task, id: "task-a" } })),
    store.save(checkpoint({ task: { ...checkpoint().task, id: "task-b" } })),
  ]);
  assert.deepEqual((await readdir(root)).sort(), ["task-a.json", "task-b.json"]);
});

test("checkpoint store rejects traversal, malformed JSON, and unknown schema versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "model-task-store-"));
  const store = new TaskCheckpointStore(root);
  assert.throws(() => store.pathFor("../escape"), /Invalid model task id/);

  await writeFile(path.join(root, "broken.json"), "not json", { mode: 0o600 });
  await assert.rejects(store.load("broken"), /Invalid JSON/);

  await writeFile(path.join(root, "future.json"), JSON.stringify({
    ...checkpoint(),
    schemaVersion: 2,
    task: { ...checkpoint().task, id: "future" },
  }), { mode: 0o600 });
  await assert.rejects(store.load("future"), /Invalid model task checkpoint/);
});
