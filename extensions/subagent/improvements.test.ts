import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ImprovementStore } from "../improvements/store.ts";
import { recordSubagentProblem, resetSubagentImprovementRecords } from "./improvements.ts";
import type { SubagentDetails } from "./schemas.ts";

function task() {
  return {
    id: "budgeted-task",
    objective: "inspect",
    acceptanceCriteria: [],
    context: [],
    scope: { cwd: process.cwd(), includePaths: ["extensions/subagent/config.ts"], excludePaths: [] },
    capability: { profile: "read-only" as const },
    budget: "small" as const,
    constraints: [],
    nonGoals: [],
    expectedOutput: "summary",
  };
}

test("subagent failures are recorded in the improvement store and deduplicated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-improvements-"));
  const previous = process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
  process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = root;
  resetSubagentImprovementRecords();
  try {
    const details: SubagentDetails = {
      task: task(),
      status: "budget-exhausted",
      budget: "small",
      usage: { turns: 6, toolCalls: 12, elapsedMs: 100 },
      events: [],
      stopReason: "turns budget exhausted",
      result: {
        taskId: "budgeted-task",
        status: "budget-exhausted",
        summary: "turns budget exhausted",
        evidence: [],
        changes: [],
        verification: [],
        risks: ["insufficient budget"],
        remainingWork: ["retry smaller"],
        questions: [],
        usage: { turns: 6, toolCalls: 12, elapsedMs: 100 },
      },
    };
    const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "session-1" } } as any;
    const first = recordSubagentProblem(ctx, details);
    const second = recordSubagentProblem(ctx, details);
    assert.ok(first);
    assert.equal(second, undefined);
    const saved = new ImprovementStore({ rootDir: root }).get(first!);
    assert.equal(saved?.context.taskId, "budgeted-task");
    assert.equal(saved?.context.tool, "subagent");
    assert.match(saved?.context.gap ?? "", /budget-exhausted/);
    assert.match(saved?.context.evidence ?? "", /"toolCalls":12/);
    assert.match(saved?.context.evidence ?? "", /"hasEvidence":false/);
  } finally {
    if (previous === undefined) delete process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
    else process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
