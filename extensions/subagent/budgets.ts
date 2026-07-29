import type { BudgetName, SubagentUsage } from "./schemas.ts";

export type Budget = {
  turns: number;
  toolCalls: number;
  wallTimeMs: number;
  providerIdleMs: number;
};

export const BUDGETS: Record<BudgetName, Budget> = {
  small: { turns: 6, toolCalls: 12, wallTimeMs: 3 * 60_000, providerIdleMs: 2 * 60_000 },
  standard: { turns: 15, toolCalls: 40, wallTimeMs: 10 * 60_000, providerIdleMs: 3 * 60_000 },
  large: { turns: 30, toolCalls: 100, wallTimeMs: 30 * 60_000, providerIdleMs: 5 * 60_000 },
};

export type BudgetExceededReason = "turns" | "tool-calls" | "wall-time";

export function exceededBudget(usage: SubagentUsage, budget: Budget): BudgetExceededReason | undefined {
  if (usage.turns >= budget.turns) return "turns";
  if (usage.toolCalls >= budget.toolCalls) return "tool-calls";
  if (usage.elapsedMs >= budget.wallTimeMs) return "wall-time";
  return undefined;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
