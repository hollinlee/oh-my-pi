import assert from "node:assert/strict";
import test from "node:test";
import { createSubagentDag, runDag, validateDag, type DagRunner, type SubagentDag, type SubagentDagInput } from "./scheduler.ts";
import type { SubagentDetails, SubagentTask } from "./schemas.ts";

function task(id: string, profile: "read-only" | "workspace-write" = "read-only", includePaths = [id]): SubagentTask {
  return {
    id,
    objective: id,
    acceptanceCriteria: [],
    context: [],
    scope: { cwd: "/repo", includePaths, excludePaths: [] },
    capability: { profile },
    budget: "small",
    constraints: [],
    nonGoals: [],
    expectedOutput: id,
  };
}

function dag(nodes: Array<{ id: string; dependencies?: string[]; task?: SubagentTask }>): SubagentDag {
  return {
    batchId: "batch-test",
    budget: "standard",
    concurrency: 3,
    nodes: nodes.map((node) => ({ id: node.id, task: node.task ?? task(node.id), dependencies: node.dependencies ?? [] })),
  };
}

function details(input: SubagentTask, status: SubagentDetails["status"] = "completed", turns = 1): SubagentDetails {
  return {
    task: input,
    status,
    budget: input.budget ?? "standard",
    usage: { turns, toolCalls: turns, elapsedMs: 1 },
    events: [],
    result: {
      taskId: input.id,
      status: status === "completed" ? "completed" : status as any,
      summary: input.id,
      evidence: [{ claim: input.id, source: "test" }],
      changes: [],
      verification: [],
      risks: [],
      remainingWork: [],
      questions: [],
      usage: { turns, toolCalls: turns, elapsedMs: 1 },
    },
  };
}

const immediateRunner: DagRunner = async (input, _signal, update) => {
  const value = details(input);
  update(value);
  return value;
};

test("batch creation derives task ids from public and legacy inputs", () => {
  const { id: _taskId, ...taskInput } = task("stale-id");
  const input: SubagentDagInput = {
    batchId: "batch-test",
    nodes: [{
      id: "canonical-id",
      dependencies: [],
      task: taskInput,
    }],
  };
  const normalized = createSubagentDag(input);
  assert.equal(normalized.nodes[0].task.id, "canonical-id");
  assert.deepEqual(validateDag(normalized), []);

  const legacyInput = {
    ...input,
    nodes: [{ ...input.nodes[0], task: { ...input.nodes[0].task, id: "stale-id" } }],
  };
  assert.equal(createSubagentDag(legacyInput).nodes[0].task.id, "canonical-id");
});

test("DAG validation rejects duplicates, missing dependencies, cycles, depth, and unordered write overlap", () => {
  assert.match(validateDag(dag([{ id: "a" }, { id: "a" }])).join("\n"), /duplicate/);
  assert.match(validateDag(dag([{ id: "a", dependencies: ["missing"] }])).join("\n"), /missing dependency/);
  const invalidOverride = task("override");
  invalidOverride.capability = { profile: "workspace-write", overrides: ["network"] };
  assert.match(validateDag(dag([{ id: "override", task: invalidOverride }])).join("\n"), /overrides require elevated/);
  const emptyElevated = task("elevated");
  emptyElevated.capability = { profile: "elevated", overrides: [] };
  assert.match(validateDag(dag([{ id: "elevated", task: emptyElevated }])).join("\n"), /requires explicit overrides/);
  assert.match(validateDag(dag([{ id: "a", dependencies: ["b"] }, { id: "b", dependencies: ["a"] }])).join("\n"), /cycle/);
  assert.match(validateDag(dag([
    { id: "a" },
    { id: "b", dependencies: ["a"] },
    { id: "c", dependencies: ["b"] },
    { id: "d", dependencies: ["c"] },
  ])).join("\n"), /max DAG depth/);
  const overlap = dag([
    { id: "a", task: task("a", "workspace-write", ["src"]) },
    { id: "b", task: task("b", "workspace-write", ["src/lib"]) },
  ]);
  assert.match(validateDag(overlap).join("\n"), /overlapping scope/);
  overlap.nodes[1].dependencies = ["a"];
  assert.deepEqual(validateDag(overlap), []);
});

test("linear and fan-out DAGs run in dependency order with bounded concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const runner: DagRunner = async (input, _signal, update) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${input.id}`);
    await new Promise((resolve) => setTimeout(resolve, input.id === "a" ? 5 : 15));
    const value = details(input);
    update(value);
    order.push(`end:${input.id}`);
    active -= 1;
    return value;
  };
  const result = await runDag(dag([
    { id: "a" },
    { id: "b", dependencies: ["a"] },
    { id: "c", dependencies: ["a"] },
    { id: "d", dependencies: ["b", "c"] },
  ]), undefined, runner);
  assert.equal(result.status, "completed");
  assert.ok(order.indexOf("end:a") < order.indexOf("start:b"));
  assert.ok(order.indexOf("end:a") < order.indexOf("start:c"));
  assert.ok(order.indexOf("end:b") < order.indexOf("start:d"));
  assert.ok(order.indexOf("end:c") < order.indexOf("start:d"));
  assert.ok(maxActive <= 3);
});

test("failed dependency blocks downstream nodes", async () => {
  const runner: DagRunner = async (input, _signal, update) => {
    const value = details(input, input.id === "a" ? "model-error" : "completed");
    update(value);
    return value;
  };
  const result = await runDag(dag([{ id: "a" }, { id: "b", dependencies: ["a"] }]), undefined, runner);
  assert.equal(result.nodes.find((node) => node.id === "a")?.status, "model-error");
  assert.equal(result.nodes.find((node) => node.id === "b")?.status, "blocked");
});

test("runner exceptions become structured runtime errors and block dependents", async () => {
  const result = await runDag(
    dag([{ id: "a" }, { id: "b", dependencies: ["a"] }]),
    undefined,
    async () => { throw new Error("runner exploded"); },
  );
  const failed = result.nodes.find((node) => node.id === "a");
  assert.equal(failed?.status, "runtime-error");
  assert.equal(failed?.details?.result?.summary, "runner exploded");
  assert.equal(result.nodes.find((node) => node.id === "b")?.status, "blocked");
});

test("batch budget aborts active work and blocks pending nodes", async () => {
  const runner: DagRunner = async (input, signal, update) => {
    update(details(input, "running", 40));
    if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return details(input, "budget-exhausted", 40);
  };
  const result = await runDag({ ...dag([{ id: "a" }, { id: "b", dependencies: ["a"] }]), budget: "small" }, undefined, runner);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.nodes.find((node) => node.id === "b")?.status, "blocked");
});

test("parent cancellation aborts active children", async () => {
  const controller = new AbortController();
  const runner: DagRunner = async (input, signal, update) => {
    update(details(input, "running"));
    if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return details(input, "cancelled");
  };
  const promise = runDag(dag([{ id: "a" }, { id: "b" }]), controller.signal, runner);
  setTimeout(() => controller.abort(), 5);
  const result = await promise;
  assert.equal(result.status, "cancelled");
  assert.ok(result.nodes.every((node) => node.status === "cancelled" || node.status === "blocked"));
});

test("aggregate result retains node evidence and usage", async () => {
  const result = await runDag(dag([{ id: "a" }, { id: "b" }]), undefined, immediateRunner);
  assert.equal(result.usage.turns, 2);
  assert.equal(result.nodes[0].details?.result?.evidence[0].claim, "a");
  assert.equal(result.nodes[1].details?.result?.evidence[0].claim, "b");
});
