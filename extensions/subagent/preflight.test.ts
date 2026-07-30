import assert from "node:assert/strict";
import test from "node:test";
import { blockedDagResult, preflightDagIsolation } from "./preflight.ts";
import type { SubagentDag } from "./scheduler.ts";
import type { SubagentTask } from "./schemas.ts";
import type { IsolationPlan } from "./worktree.ts";

function task(id: string, profile: SubagentTask["capability"]["profile"], cwd: string): SubagentTask {
  return {
    id,
    objective: id,
    acceptanceCriteria: [],
    context: [],
    scope: { cwd, includePaths: ["."] },
    capability: profile === "elevated" ? { profile, overrides: ["network"] } : { profile },
    budget: "small",
    constraints: [],
    nonGoals: [],
    expectedOutput: id,
  };
}

function dag(): SubagentDag {
  return {
    batchId: "preflight-test",
    nodes: [
      { id: "read", dependencies: [], task: task("read", "read-only", "/read") },
      { id: "write-a", dependencies: [], task: task("write-a", "workspace-write", "/dirty") },
      { id: "write-b", dependencies: [], task: task("write-b", "elevated", "/dirty") },
      { id: "write-c", dependencies: [], task: task("write-c", "workspace-write", "/clean") },
    ],
  };
}

test("batch preflight skips read-only nodes and groups shared isolation blockers", async () => {
  const inspected: string[] = [];
  const inspect = async (cwd: string): Promise<IsolationPlan> => {
    inspected.push(cwd);
    if (cwd === "/dirty") {
      return { status: "blocked", code: "tracked-dirty", sourcePath: cwd, gitRoot: "/repo", reason: "dirty repo" };
    }
    return { status: "ready", mode: "git-worktree", sourcePath: cwd, gitRoot: cwd };
  };
  const result = await preflightDagIsolation(dag(), "/fallback", inspect);
  assert.deepEqual(inspected.sort(), ["/clean", "/dirty", "/dirty"]);
  assert.equal(result.blockers.length, 1);
  assert.deepEqual(result.blockers[0].nodeIds, ["write-a", "write-b"]);
  assert.equal(result.reasonsByNode.get("write-a"), "dirty repo");
  assert.equal(result.reasonsByNode.has("read"), false);
  const blocked = blockedDagResult(dag(), result);
  assert.equal(blocked?.status, "preflight-blocked");
  assert.equal(blocked?.usage.turns, 0);
  assert.ok(blocked?.nodes.every((node) => node.status === "blocked"));
  assert.match(blocked?.nodes.find((node) => node.id === "read")?.blockedReason ?? "", /no child was started/);
  assert.equal(blocked?.errors.length, 1);
});

test("batch preflight uses the parent cwd when task cwd is omitted", async () => {
  const value = dag();
  value.nodes = [{ id: "write", dependencies: [], task: { ...task("write", "workspace-write", "/unused"), scope: {} } }];
  let inspected = "";
  await preflightDagIsolation(value, "/parent", async (cwd) => {
    inspected = cwd;
    return { status: "ready", mode: "directory-copy", sourcePath: cwd };
  });
  assert.equal(inspected, "/parent");
});
