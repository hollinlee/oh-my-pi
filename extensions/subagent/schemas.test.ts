import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { SubmittedSubagentResultSchema } from "./schemas.ts";

const result = {
  taskId: "task",
  status: "completed",
  summary: "done",
  evidence: [],
  changes: [],
  verification: [],
  risks: [],
  remainingWork: [],
  questions: [],
};

test("child submitted result cannot fabricate parent-owned handoff metadata", () => {
  const fabricated = {
    ...result,
    handoff: {
      mode: "directory-copy",
      state: "cleaned",
      sourcePath: "/fake",
      workspacePath: "/fake",
      changedPaths: [],
      untrackedPaths: [],
      binaryPaths: [],
      retained: false,
    },
  };
  assert.equal(Value.Check(SubmittedSubagentResultSchema, fabricated), false);
});
