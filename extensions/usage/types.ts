export type UsageEvent = {
  identity: string;
  timestamp: string;
  operation: "assistant" | "toolResult" | "compaction" | "branch_summary";
  provider: string;
  model: string;
  projectPath: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  responses: number;
};

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  responses: number;
};
