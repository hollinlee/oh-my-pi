import assert from "node:assert/strict";
import test from "node:test";
import { requiresInteractiveApproval } from "./approval.ts";
import type { BudgetName, SubagentTask } from "./schemas.ts";

function task(profile: SubagentTask["capability"]["profile"], budget: BudgetName): SubagentTask {
  return {
    id: `${profile}-${budget}`,
    objective: "test approval boundary",
    acceptanceCriteria: [],
    context: [],
    scope: { cwd: "/repo", includePaths: ["."], excludePaths: [] },
    capability: profile === "elevated" ? { profile, overrides: ["network"] } : { profile },
    budget,
    constraints: [],
    nonGoals: [],
    expectedOutput: "test",
  };
}

test("only elevated subagents require interactive approval", () => {
  for (const budget of ["small", "standard", "large"] as const) {
    assert.equal(requiresInteractiveApproval(task("read-only", budget)), false);
    assert.equal(requiresInteractiveApproval(task("workspace-write", budget)), false);
    assert.equal(requiresInteractiveApproval(task("elevated", budget)), true);
  }
});
