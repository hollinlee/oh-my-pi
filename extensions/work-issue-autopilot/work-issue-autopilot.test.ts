import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkflowCheckpoint, parseWorkIssueQueue, type WorkIssueState } from "../work-issue-autopilot.ts";

function state(): WorkIssueState {
  return {
    queue: ["20", "21", "22"],
    remaining: ["20", "21", "22"],
    phase: "active",
    stalledContinuations: 3,
    updatedAt: 1,
  };
}

test("work-issue parser preserves explicit queue order and removes duplicates", () => {
  assert.deepEqual(
    parseWorkIssueQueue("/work-issue #20 https://github.com/acme/repo/issues/21 22 #20"),
    ["20", "21", "22"],
  );
  assert.deepEqual(parseWorkIssueQueue("continue issue 20"), []);
});

test("progress checkpoints reset the stalled continuation counter", () => {
  const next = applyWorkflowCheckpoint(state(), { status: "progress", summary: "tests running" });
  assert.equal(next.phase, "active");
  assert.equal(next.stalledContinuations, 0);
  assert.deepEqual(next.remaining, ["20", "21", "22"]);
});

test("issue and queue completion advance deterministic state", () => {
  const afterIssue = applyWorkflowCheckpoint(state(), { status: "issue-completed", issue: "#20", summary: "merged" });
  assert.deepEqual(afterIssue.remaining, ["21", "22"]);
  assert.equal(afterIssue.phase, "active");
  const done = applyWorkflowCheckpoint(afterIssue, { status: "queue-completed", summary: "all merged" });
  assert.equal(done.phase, "completed");
  assert.deepEqual(done.remaining, []);
});

test("human gate blocks automatic continuation with its reason", () => {
  const next = applyWorkflowCheckpoint(state(), { status: "human-gate", summary: "scope changed", blocker: "choose API semantics" });
  assert.equal(next.phase, "blocked");
  assert.equal(next.blocker, "choose API semantics");
});
