import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RETRIES, RETRY_DELAYS_MS, retryAttemptLabel, retryDelayMs, runtimeStageLabel, turnSummaryLabel } from "./phase-trace-runtime.ts";

test("retry policy is bounded and follows the published schedule", () => {
  assert.equal(MAX_RETRIES, 10);
  assert.deepEqual(RETRY_DELAYS_MS, [1000, 2000, 2000, 5000, 9000, 20000, 38000, 38000, 38000, 40000]);
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(retryDelayMs(99), 40000);
  assert.equal(retryAttemptLabel(3), "3/10");
});

test("provider requested delay takes precedence", () => {
  assert.equal(retryDelayMs(1, 12_345), 12_345);
  assert.equal(retryDelayMs(1, -1), 1000);
});

test("runtime labels hide native reasoning and connecting text", () => {
  assert.equal(runtimeStageLabel("Thinking..."), "Working");
  assert.equal(runtimeStageLabel("Connecting to provider"), "Waiting");
  assert.equal(runtimeStageLabel(""), "Waiting");
});

test("turn summaries use stable terminal labels", () => {
  assert.equal(turnSummaryLabel("stop", "4s"), "✻ Done in 4s");
  assert.equal(turnSummaryLabel("error", "4s"), "✻ Failed after 4s");
  assert.equal(turnSummaryLabel("aborted", "4s"), "✻ Cancelled after 4s");
});
