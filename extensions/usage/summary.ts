import type { UsageTotals } from "./types.ts";

export function todayRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function tokens(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatTodaySummary(totals: UsageTotals): string {
  const total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  const cacheBase = totals.input + totals.cacheRead;
  const hitRate = cacheBase > 0 ? totals.cacheRead / cacheBase * 100 : 0;
  return [
    "Today",
    `Total: ${tokens(total)} tokens`,
    `Input: ${tokens(totals.input)}`,
    `Output: ${tokens(totals.output)}`,
    `Cache hit rate: ${hitRate.toFixed(1)}%`,
    `Cost: $${totals.cost.toFixed(4)}`,
    `Responses: ${tokens(totals.responses)}`,
  ].join("\n");
}
