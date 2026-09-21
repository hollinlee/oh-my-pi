import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  SPINNER_FRAMES,
  applyPhaseTraceAction,
  formatPhaseDuration,
  initialPhaseTraceState,
  renderPhaseTraceLines,
  renderRuntimeStatusLines,
  summarizeToolCall,
  summarizeToolResult,
} from "../phase-trace.ts";
import { createRuntimeState, settleRuntime, startRuntime, startRuntimeRetry, transitionRuntime } from "./phase-trace-runtime.ts";

const plainTheme = { fg: (_name: string, text: string) => text };

test("runtime activity uses the approved 80ms star animation", () => {
  assert.deepEqual(SPINNER_FRAMES, ["✻", "✽", "✳", "✽"]);
});

test("runtime renderer is zero rows when idle, one row normally, and two rows for retry", () => {
  let runtime = transitionRuntime(startRuntime(createRuntimeState(), 0), "Analyzing", 0);
  const normal = renderRuntimeStatusLines(runtime, plainTheme, 40, 80);
  assert.equal(normal.length, 1);
  assert.ok(normal.every((line) => visibleWidth(line) <= 40));
  assert.doesNotMatch(normal[0] ?? "", /Inspect/);
  assert.ok(normal[0]?.startsWith(" ") && normal[0]?.endsWith(" "));

  runtime = startRuntimeRetry(runtime, 1, "provider unavailable with a long diagnostic", 100, 2_000);
  const retry = renderRuntimeStatusLines(runtime, plainTheme, 40, 180);
  assert.equal(retry.length, 2);
  assert.ok(retry.every((line) => visibleWidth(line) <= 40));
  assert.match(retry[0] ?? "", /Provider requested retry/);

  runtime = settleRuntime(runtime, "Failed", 200);
  assert.deepEqual(renderRuntimeStatusLines(runtime, plainTheme, 40, 200), []);
});

test("phase trace replaces an empty Working fallback with an explicit canonical phase", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "reset", now: 1000 });
  state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: 1000, implicit: true });
  state = applyPhaseTraceAction(state, { type: "start", name: "Implement", now: 2000 });

  assert.equal(state.phases.length, 1);
  assert.equal(state.phases[0]?.name, "Implement");
  assert.equal(state.phases[0]?.status, "running");
});

test("starting a new phase completes the previous phase", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Inspect", now: 1000 });
  state = applyPhaseTraceAction(state, { type: "start", name: "Implement", now: 4000 });

  assert.equal(state.phases[0]?.status, "completed");
  assert.equal(state.phases[0]?.endedAt, 4000);
  assert.equal(state.phases[1]?.status, "running");
});

test("tool results remain attached to the phase active when the tool started", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Inspect", now: 0 });
  const inspectId = state.activePhaseId;
  state = applyPhaseTraceAction(state, { type: "start", name: "Build", now: 1000 });
  const buildId = state.activePhaseId;
  state = applyPhaseTraceAction(state, { type: "append-summary", summary: "read completed", phaseId: inspectId });

  assert.deepEqual(state.phases[0]?.summaries, ["read completed"]);
  assert.deepEqual(state.phases[1]?.summaries, []);
  assert.equal(state.activePhaseId, buildId);
});

test("a late tool failure does not close the newer active phase", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Inspect", now: 0 });
  const inspectId = state.activePhaseId;
  state = applyPhaseTraceAction(state, { type: "start", name: "Build", now: 1000 });
  const buildId = state.activePhaseId;
  state = applyPhaseTraceAction(state, { type: "finish", status: "failed", now: 2000, phaseId: inspectId });

  assert.equal(state.phases[0]?.status, "failed");
  assert.equal(state.phases[1]?.status, "running");
  assert.equal(state.activePhaseId, buildId);
});

test("subagent lifecycle is grouped under its dispatch phase with actual model", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Implement", now: 1000 });
  const phaseId = state.activePhaseId!;
  state = applyPhaseTraceAction(state, {
    type: "upsert-subagent",
    phaseId,
    taskId: "compile-check",
    status: "running",
    model: "Claude Sonnet 4.6",
    now: 3000,
    elapsedMs: 2000,
  });
  state = applyPhaseTraceAction(state, {
    type: "upsert-subagent",
    phaseId,
    taskId: "compile-check",
    status: "completed",
    model: "Claude Sonnet 4.6",
    now: 5000,
  });

  assert.deepEqual(state.phases[0]?.subagents, [{
    taskId: "compile-check",
    status: "completed",
    model: "Claude Sonnet 4.6",
    startedAt: 1000,
    endedAt: 5000,
  }]);
  state = applyPhaseTraceAction(state, { type: "set-expanded", expanded: true });
  const expanded = renderPhaseTraceLines(state, plainTheme, 100, 5000);
  assert.ok(expanded.some((line) => /subagents 1 · Claude Sonnet 4\.6/.test(line)));
});

test("pending subagents stay queued until execution starts", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Verify", now: 0 });
  const phaseId = state.activePhaseId!;
  state = applyPhaseTraceAction(state, { type: "upsert-subagent", phaseId, taskId: "dependent", status: "pending", model: "Sonnet", now: 1000 });
  assert.equal(state.phases[0]?.subagents[0]?.startedAt, undefined);

  state = applyPhaseTraceAction(state, { type: "upsert-subagent", phaseId, taskId: "dependent", status: "running", model: "Sonnet", now: 5000, elapsedMs: 250 });
  assert.equal(state.phases[0]?.subagents[0]?.startedAt, 4750);
});

test("expanded trace shows mixed subagent models and statuses", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Verify", now: 0 });
  const phaseId = state.activePhaseId!;
  state = applyPhaseTraceAction(state, { type: "upsert-subagent", phaseId, taskId: "tests", status: "completed", model: "Sonnet", now: 2000 });
  state = applyPhaseTraceAction(state, { type: "upsert-subagent", phaseId, taskId: "lint", status: "running", model: "Haiku", now: 3000 });
  state = applyPhaseTraceAction(state, { type: "set-expanded", expanded: true });

  const lines = renderPhaseTraceLines(state, plainTheme, 100, 4000);
  assert.match(lines[0] ?? "", /subagents 2 · 2 models/);
  assert.ok(lines.some((line) => /tests · Sonnet · completed/.test(line)));
  assert.ok(lines.some((line) => /lint · Haiku · running/.test(line)));
});

test("phase trace keeps only the latest eight summaries", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Verify", now: 0 });
  for (let index = 0; index < 10; index++) {
    state = applyPhaseTraceAction(state, { type: "append-summary", summary: `check ${index}` });
  }

  assert.equal(state.phases[0]?.summaries.length, 8);
  assert.equal(state.phases[0]?.summaries[0], "check 2");
  assert.equal(state.phases[0]?.summaries[7], "check 9");
});

test("failed phases preserve their outcome and expand automatically", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Build", now: 0 });
  state = applyPhaseTraceAction(state, { type: "finish", status: "failed", now: 2500, summary: "typecheck failed" });

  assert.equal(state.phases[0]?.status, "failed");
  assert.deepEqual(state.phases[0]?.summaries, ["typecheck failed"]);
  assert.equal(state.expanded, true);
});

test("finishing a turn completes the active phase and collapses the trace", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "reset", now: 0 });
  state = applyPhaseTraceAction(state, { type: "start", name: "Review", now: 1000 });
  state = applyPhaseTraceAction(state, { type: "set-expanded", expanded: true });
  state = applyPhaseTraceAction(state, { type: "finish-turn", now: 5000 });

  assert.equal(state.phases[0]?.status, "completed");
  assert.equal(state.expanded, false);
  assert.equal(state.turnEndedAt, 5000);
});

test("finishing a failed turn preserves automatic expansion", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Build", now: 0 });
  state = applyPhaseTraceAction(state, { type: "finish", status: "failed", now: 2000 });
  state = applyPhaseTraceAction(state, { type: "finish-turn", now: 3000 });

  assert.equal(state.expanded, true);
  assert.equal(state.phases[0]?.status, "failed");
});

test("implicit Working is visible with an elapsed timer", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "reset", now: 1000 });
  state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: 1000, implicit: true });
  const lines = renderPhaseTraceLines(state, plainTheme, 80, 2040, { kind: "working" });
  assert.deepEqual(lines, ["✽ Working"]);
});

test("rendering is width bounded in collapsed and expanded modes", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "reset", now: 0 });
  state = applyPhaseTraceAction(state, { type: "start", name: "Implement", now: 1000, summary: "a long implementation summary for width clipping" });
  const collapsed = renderPhaseTraceLines(state, plainTheme, 24, 4000);
  assert.ok(collapsed.every((line) => visibleWidth(line) <= 24));

  state = applyPhaseTraceAction(state, { type: "set-expanded", expanded: true });
  const expanded = renderPhaseTraceLines(state, plainTheme, 32, 4000);
  assert.ok(expanded.every((line) => visibleWidth(line) <= 32));
  assert.match(expanded.at(-1) ?? "", /Total/);
});

test("duration formatting is stable across minute and hour boundaries", () => {
  assert.equal(formatPhaseDuration(0, 42_000), "00:42");
  assert.equal(formatPhaseDuration(0, 61_000), "01:01");
  assert.equal(formatPhaseDuration(0, 3_661_000), "1:01:01");
});

test("tool activity produces bounded phase summaries", () => {
  assert.equal(summarizeToolCall("read", { path: "/tmp/example.ts" }), "read · /tmp/example.ts");
  assert.equal(summarizeToolCall("bash", { command: "npm test\nignored" }), "bash · npm test ignored");
  assert.match(summarizeToolResult("bash", { content: [{ type: "text", text: "209 tests passed" }] }, false), /^✓ bash · 209 tests passed$/);
  assert.match(summarizeToolResult("bash", { details: { error: "typecheck failed" } }, true), /^× bash · typecheck failed$/);
});

test("non-canonical phase names become visible Working fallback", () => {
  let state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Build", now: 0 });
  assert.equal(state.phases[0]?.name, "Working");
  assert.equal(state.phases[0]?.implicit, true);
  assert.deepEqual(renderPhaseTraceLines(state, plainTheme, 80, 0), ["○ Working · 00:00"]);

  state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Implement", now: 0 });
  assert.equal(state.phases[0]?.name, "Implement");
  assert.equal(state.phases[0]?.implicit, false);
});

test("collapsed trace merges phase and realtime status into one row", () => {
  const state = applyPhaseTraceAction(initialPhaseTraceState(), { type: "start", name: "Implement", now: 0 });
  const lines = renderPhaseTraceLines(state, plainTheme, 40, 80, { kind: "tool", summary: "bash · npm test" });
  assert.deepEqual(lines, ["✽ Implement · Running bash · npm test"]);
});
