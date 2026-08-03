import assert from "node:assert/strict";
import test from "node:test";
import { BUDGETS, exceededBudget, formatElapsed } from "./budgets.ts";

test("budget presets match the public contract", () => {
  assert.deepEqual(BUDGETS.small, { turns: 6, toolCalls: 12, wallTimeMs: 180_000, providerIdleMs: 120_000, toolResultBytes: 12_288, toolOutputBytes: 49_152 });
  assert.deepEqual(BUDGETS.standard, { turns: 15, toolCalls: 40, wallTimeMs: 600_000, providerIdleMs: 180_000, toolResultBytes: 24_576, toolOutputBytes: 163_840 });
  assert.deepEqual(BUDGETS.large, { turns: 30, toolCalls: 100, wallTimeMs: 1_800_000, providerIdleMs: 300_000, toolResultBytes: 49_152, toolOutputBytes: 491_520 });
});

test("budget enforcement reports each hard limit", () => {
  assert.equal(exceededBudget({ turns: 6, toolCalls: 0, elapsedMs: 0 }, BUDGETS.small), "turns");
  assert.equal(exceededBudget({ turns: 0, toolCalls: 12, elapsedMs: 0 }, BUDGETS.small), "tool-calls");
  assert.equal(exceededBudget({ turns: 0, toolCalls: 0, toolOutputBytes: 49_152, elapsedMs: 0 }, BUDGETS.small), "tool-output");
  assert.equal(exceededBudget({ turns: 0, toolCalls: 0, elapsedMs: 180_000 }, BUDGETS.small), "wall-time");
  assert.equal(exceededBudget({ turns: 5, toolCalls: 11, elapsedMs: 179_999 }, BUDGETS.small), undefined);
});

test("elapsed formatting is stable", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(61_000), "01:01");
  assert.equal(formatElapsed(1_800_000), "30:00");
});
