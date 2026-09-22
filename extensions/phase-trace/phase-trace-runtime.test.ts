import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  createRuntimeState,
  finishRuntimeTool,
  parseRetryAfterMs,
  retryAttemptLabel,
  retryDelayMs,
  runtimeStageLabel,
  runtimeTimings,
  settleRuntime,
  startRuntime,
  startRuntimeRetry,
  startRuntimeTool,
  terminalOutcome,
  transitionRuntime,
  turnSummaryLabel,
} from "./phase-trace-runtime.ts";

test("same runtime stage keeps its original start time across streaming updates", () => {
  let runtime = transitionRuntime(startRuntime(createRuntimeState(), 0), "Responding", 0);
  runtime = transitionRuntime(runtime, "Responding", 400);
  runtime = transitionRuntime(runtime, "Responding", 900);

  assert.equal(runtime.stageStartedAt, 0);
  assert.equal(runtime.totals.responding, 900);
});

test("retry policy is bounded and follows the published schedule", () => {
  assert.equal(MAX_RETRIES, 10);
  assert.deepEqual(RETRY_DELAYS_MS, [1000, 2000, 2000, 5000, 9000, 20000, 38000, 38000, 38000, 40000]);
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(retryDelayMs(99), 40000);
  assert.equal(retryAttemptLabel(3), "3/10");
  assert.equal(retryAttemptLabel(99), "10/10");
});

test("provider Retry-After header takes precedence without parsing error prose", () => {
  const now = Date.parse("2026-09-21T00:00:00Z");
  assert.equal(parseRetryAfterMs({ "Retry-After": "12.345" }, now), 12_345);
  assert.equal(parseRetryAfterMs({ "retry-after": "Sun, 21 Sep 2026 00:00:09 GMT" }, now), 9_000);
  assert.equal(parseRetryAfterMs({ "Retry-After": "invalid" }, now), undefined);
  assert.equal(retryDelayMs(1, 12_345), 12_345);
});

test("runtime timing buckets are mutually exclusive", () => {
  let state = startRuntime(createRuntimeState(), 0);
  state = transitionRuntime(state, "Analyzing", 1_000);
  state = transitionRuntime(state, "Responding", 3_000);
  state = settleRuntime(state, "Done", 6_000);

  assert.deepEqual(runtimeTimings(state, 10_000), {
    waiting: 1_000,
    analyzing: 2_000,
    responding: 3_000,
    executing: 0,
    retrying: 0,
    compacting: 0,
    summarizing: 0,
    total: 6_000,
  });
});

test("parallel tools stay Running until the last tool ends", () => {
  let state = startRuntime(createRuntimeState(), 0);
  state = startRuntimeTool(state, "a", "bash · npm test", 100);
  state = startRuntimeTool(state, "b", "read · package.json", 200);
  state = finishRuntimeTool(state, "a", 500, "failed");
  assert.equal(state.stage, "Running");
  assert.equal(state.stageDetail, "read · package.json");
  assert.equal(state.failedTools, 1);
  assert.equal(state.active, true);

  state = finishRuntimeTool(state, "b", 800, "completed");
  assert.equal(state.stage, "Waiting");
  assert.equal(state.completedTools, 1);
  assert.equal(state.failedTools, 1);
});

test("retry remains active until settled and uses provider metadata", () => {
  let state = startRuntime(createRuntimeState(), 0);
  state = startRuntimeRetry(state, 2, "capacity unavailable", 1_000, 7_500);
  assert.equal(state.stage, "Retrying");
  assert.deepEqual(state.retry, {
    attempt: 2,
    maxAttempts: 10,
    delayMs: 7_500,
    until: 8_500,
    error: "capacity unavailable",
    providerRequested: true,
  });

  state = transitionRuntime(state, "Waiting", 8_500);
  assert.equal(state.active, true);
  assert.equal(state.retry, undefined);
  state = settleRuntime(state, "Failed", 9_000);
  assert.equal(state.active, false);
  assert.equal(state.outcome, "Failed");
});

test("runtime labels hide native reasoning and connecting text", () => {
  assert.equal(runtimeStageLabel("Thinking..."), "Analyzing");
  assert.equal(runtimeStageLabel("Connecting to provider"), "Waiting");
  assert.equal(runtimeStageLabel("Running bash"), "Running");
  assert.equal(runtimeStageLabel("Compacting context"), "Compacting");
  assert.equal(runtimeStageLabel(""), "Waiting");
});

test("turn summaries use the four stable terminal outcomes", () => {
  assert.equal(terminalOutcome("stop"), "Done");
  assert.equal(terminalOutcome("error", "This operation was aborted"), "Cancelled");
  assert.equal(terminalOutcome("error", "provider unavailable"), "Failed");
  assert.equal(terminalOutcome("aborted"), "Cancelled");
  assert.equal(terminalOutcome("length"), "Truncated");

  assert.equal(turnSummaryLabel("stop", "4s"), "✻ Done in 4s");
  assert.equal(turnSummaryLabel("error", "4s"), "✻ Failed after 4s");
  assert.equal(turnSummaryLabel("error", "4s", "This operation was aborted"), "✻ Cancelled after 4s");
  assert.equal(turnSummaryLabel("aborted", "4s"), "✻ Cancelled after 4s");
  assert.equal(turnSummaryLabel("length", "4s"), "⚠ Response truncated after 4s");
});
