import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export const BudgetNameSchema = StringEnum(["small", "standard", "large"] as const);
export type BudgetName = Static<typeof BudgetNameSchema>;

export const SubagentStatusSchema = StringEnum([
  "completed",
  "needs-context",
  "incomplete",
  "budget-exhausted",
  "cancelled",
  "tool-error",
  "runtime-error",
  "model-error",
] as const);
export type SubagentStatus = Static<typeof SubagentStatusSchema>;

export const SubagentResultSchema = Type.Object({
  taskId: Type.String(),
  status: SubagentStatusSchema,
  summary: Type.String(),
  evidence: Type.Array(Type.Object({ claim: Type.String(), source: Type.String() })),
  changes: Type.Array(Type.Object({ path: Type.String(), summary: Type.String() })),
  verification: Type.Array(Type.Object({ command: Type.Optional(Type.String()), outcome: Type.String() })),
  risks: Type.Array(Type.String()),
  remainingWork: Type.Array(Type.String()),
  questions: Type.Array(Type.String()),
  usage: Type.Optional(Type.Object({
    turns: Type.Number(),
    toolCalls: Type.Number(),
    tokens: Type.Optional(Type.Number()),
    cost: Type.Optional(Type.Number()),
    elapsedMs: Type.Number(),
  })),
});
export type SubmittedSubagentResult = Static<typeof SubagentResultSchema>;

export const SubagentTaskSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80 }),
  objective: Type.String({ minLength: 1 }),
  acceptanceCriteria: Type.Array(Type.String()),
  context: Type.Array(Type.String()),
  scope: Type.Object({
    cwd: Type.Optional(Type.String()),
    includePaths: Type.Optional(Type.Array(Type.String())),
    excludePaths: Type.Optional(Type.Array(Type.String())),
  }),
  capability: Type.Object({
    profile: StringEnum(["read-only"] as const, { description: "Issue #66 only supports read-only." }),
    overrides: Type.Optional(Type.Array(Type.String(), { maxItems: 0 })),
  }),
  budget: Type.Optional(BudgetNameSchema),
  constraints: Type.Array(Type.String()),
  nonGoals: Type.Array(Type.String()),
  expectedOutput: Type.String(),
});
export type SubagentTask = Static<typeof SubagentTaskSchema>;

export type SubagentUsage = {
  turns: number;
  toolCalls: number;
  tokens?: number;
  cost?: number;
  elapsedMs: number;
};

export type SubagentResult = Omit<SubmittedSubagentResult, "usage"> & { usage: SubagentUsage };

export type SubagentEvent = {
  at: number;
  kind: "turn" | "tool" | "text" | "status";
  text: string;
};

export type SubagentDetails = {
  task: SubagentTask;
  status: "starting" | "running" | SubagentStatus;
  budget: BudgetName;
  usage: SubagentUsage;
  lastActivity?: string;
  events: SubagentEvent[];
  result?: SubagentResult;
  stopReason?: string;
};
