import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
