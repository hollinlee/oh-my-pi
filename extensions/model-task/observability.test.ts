import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_TASK_SCHEMA_VERSION, type TaskCheckpoint } from "./schemas.ts";
import {
  MODEL_TASK_PROGRESS_INTERVAL_MS,
  TaskProgressTracker,
  formatFinalReport,
  formatTaskStatus,
  redactTaskDisplay,
  snapshotFromCheckpoint,
} from "./observability.ts";

function checkpoint(overrides: Partial<TaskCheckpoint> = {}): TaskCheckpoint {
  return {
    schemaVersion: MODEL_TASK_SCHEMA_VERSION,
    revision: 3,
    task: {
      schemaVersion: MODEL_TASK_SCHEMA_VERSION,
      id: "observe-1",
      goal: "Implement progress",
      context: [],
      constraints: [],
      scope: { cwd: "/repo", includePaths: ["src"], excludePaths: [] },
      acceptanceCriteria: ["observable"],
      escalationRules: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    status: "running",
    phase: "verification",
    updatedAt: "2026-01-01T00:01:00.000Z",
    activeModel: { provider: "local", model: "coder", role: "execution", source: "project" },
    events: [
      { id: "queued", at: "2026-01-01T00:00:00.000Z", kind: "status", summary: "Task queued" },
      { id: "model", at: "2026-01-01T00:00:01.000Z", kind: "model", summary: "Using coder" },
      { id: "tool", at: "2026-01-01T00:00:02.000Z", kind: "tool", summary: "Run tests", details: { command: "npm test" } },
    ],
    ...overrides,
  };
}

test("snapshot exposes bounded task, phase, model provenance, events, commands and elapsed time", () => {
  const value = snapshotFromCheckpoint(checkpoint(), Date.parse("2026-01-01T00:10:00.000Z"));
  assert.equal(value.elapsedMs, 600_000);
  assert.deepEqual(value.model, { provider: "local", name: "coder", role: "execution", source: "project" });
  assert.deepEqual(value.commandSummaries, ["npm test"]);
  assert.match(formatTaskStatus(value), /observe-1 · verification\/running · 10m00s · coder/);
  assert.equal(JSON.stringify(value).includes("transcript"), false);
});

test("tracker emits critical events once and rate-limits ten-minute heartbeats", () => {
  const tracker = new TaskProgressTracker();
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(tracker.update(checkpoint(), start).heartbeat, undefined);
  assert.equal(tracker.update(checkpoint(), start + MODEL_TASK_PROGRESS_INTERVAL_MS - 1).heartbeat, undefined);
  assert.match(tracker.update(checkpoint(), start + MODEL_TASK_PROGRESS_INTERVAL_MS).heartbeat ?? "", /observe-1/);
  assert.equal(tracker.update(checkpoint(), start + MODEL_TASK_PROGRESS_INTERVAL_MS + 1).heartbeat, undefined);

  const blocked = checkpoint({
    status: "needs_review",
    events: [...checkpoint().events, { id: "risk", at: "2026-01-01T00:10:01.000Z", kind: "escalation", summary: "Approval required" }],
  });
  const first = tracker.update(blocked, start + MODEL_TASK_PROGRESS_INTERVAL_MS + 1000);
  assert.deepEqual(first.immediate, [{ level: "warning", text: "observe-1 · needs_review: Approval required" }]);
  assert.equal(tracker.update(blocked, start + MODEL_TASK_PROGRESS_INTERVAL_MS + 2000).immediate.length, 0);
});

test("final report is structured and redacts credentials without exposing full transcript", () => {
  const done = checkpoint({
    status: "succeeded",
    phase: "completed",
    result: {
      summary: "done token=super-secret-value",
      models: [],
      changes: [{ path: "src/a.ts", summary: "updated" }],
      verification: [{ command: "npm test", outcome: "pass", logPath: "/tmp/test.log" }],
      risks: ["none"],
      unresolved: [],
      nextActions: ["merge"],
    },
  });
  const report = formatFinalReport(done) as any;
  assert.match(report.summary, /\[REDACTED\]/);
  assert.deepEqual(report.verification, ["npm test: pass"]);
  assert.equal("transcript" in report, false);
  assert.equal(redactTaskDisplay("Authorization: Bearer super-secret"), "Authorization: [REDACTED]");
  assert.equal(redactTaskDisplay('{"apiKey":"json-secret","Authorization":"Bearer auth-secret"}'), '{"apiKey":"[REDACTED]","Authorization":"[REDACTED]"}');
});

test("snapshot bounds every result collection", () => {
  const many = Array.from({ length: 100 }, (_, index) => `item-${index}`);
  const done = checkpoint({
    status: "succeeded",
    result: {
      summary: "done",
      models: [],
      changes: many.map((item) => ({ path: item, summary: item })),
      verification: many.map((item) => ({ command: item, outcome: "pass", logPath: `/logs/${item}` })),
      risks: many,
      unresolved: many,
      nextActions: many,
    },
  });
  const value = snapshotFromCheckpoint(done);
  assert.equal(value.verification.length, 20);
  assert.equal(value.logs.length, 20);
  assert.equal(value.final?.changes.length, 30);
  assert.equal(value.final?.risks.length, 30);
  assert.equal(value.final?.nextActions.length, 30);
});
