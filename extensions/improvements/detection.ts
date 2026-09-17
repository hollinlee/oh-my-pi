import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactToolRenderers } from "../compact-tool-renderer.ts";
import { ImprovementStore, type ImprovementContext } from "./store.ts";

type ToolFact = {
  tool: string;
  calls: number;
  errors: number;
  truncated: number;
  outputChars: number;
  totalDurationMs: number;
  completed: number;
  lastDurationMs?: number;
  lastStatus?: "ok" | "error";
};

const MAX_FACTS = 20;
const facts = new Map<string, ToolFact>();
const starts = new Map<string, number>();
const savedTaskIssues = new Set<string>();

function toolFact(tool: string): ToolFact {
  const existing = facts.get(tool);
  if (existing) {
    facts.delete(tool);
    facts.set(tool, existing);
    return existing;
  }
  const created: ToolFact = { tool, calls: 0, errors: 0, truncated: 0, outputChars: 0, totalDurationMs: 0, completed: 0 };
  facts.set(tool, created);
  while (facts.size > MAX_FACTS) facts.delete(facts.keys().next().value!);
  return created;
}

function wasTruncated(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const value = details as { truncated?: unknown; truncation?: { truncated?: unknown } };
  return value.truncated === true || value.truncation?.truncated === true;
}

function factsPrompt(): string {
  const values = [...facts.values()];
  if (values.length === 0) return "";
  return [
    "Recent tool facts for improvement-suggestion triage (signals only; do not auto-save or treat a one-off failure as friction):",
    ...values.map((fact) => {
      const averageDurationMs = fact.completed > 0 ? Math.round(fact.totalDurationMs / fact.completed) : 0;
      return `- ${fact.tool}: calls=${fact.calls}, errors=${fact.errors}, truncated=${fact.truncated}, outputChars=${fact.outputChars}, avgDurationMs=${averageDurationMs}, lastDurationMs=${fact.lastDurationMs ?? "unknown"}, lastStatus=${fact.lastStatus ?? "pending"}`;
    }),
  ].join("\n");
}

function contextFromParams(params: Record<string, unknown>, fallbackSessionId?: string): ImprovementContext {
  return {
    goal: String(params.goal ?? ""),
    capability: typeof params.capability === "string" ? params.capability : undefined,
    tool: typeof params.tool === "string" ? params.tool : undefined,
    skill: typeof params.skill === "string" ? params.skill : undefined,
    extension: typeof params.extension === "string" ? params.extension : undefined,
    parameters: params.parameters,
    evidence: typeof params.evidence === "string" ? params.evidence : undefined,
    attempts: Array.isArray(params.attempts) ? params.attempts.filter((item): item is string => typeof item === "string") : undefined,
    gap: typeof params.gap === "string" ? params.gap : undefined,
    recommendation: typeof params.recommendation === "string" ? params.recommendation : undefined,
    sessionId: typeof params.sessionId === "string" ? params.sessionId : fallbackSessionId,
    taskId: typeof params.taskId === "string" ? params.taskId : undefined,
    projectPath: typeof params.projectPath === "string" ? params.projectPath : undefined,
  };
}

function issueKey(context: ImprovementContext): string {
  const scope = context.taskId ?? context.sessionId ?? "session-unknown";
  const capability = context.tool ?? context.skill ?? context.extension ?? context.capability ?? "capability";
  return `${scope}:${capability}:${context.gap ?? context.recommendation ?? context.goal}`;
}

export function resetImprovementFacts(): void {
  facts.clear();
  starts.clear();
  savedTaskIssues.clear();
}

export function registerImprovementDetection(pi: ExtensionAPI): void {
  pi.on("session_start", () => resetImprovementFacts());

  pi.on("tool_execution_start", (event) => {
    starts.set(event.toolCallId, Date.now());
  });

  pi.on("tool_call", (event) => {
    toolFact(event.toolName).calls += 1;
  });

  pi.on("tool_result", (event) => {
    const fact = toolFact(event.toolName);
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    const durationMs = startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt);
    if (durationMs !== undefined) {
      fact.lastDurationMs = durationMs;
      fact.totalDurationMs += durationMs;
      fact.completed += 1;
    }
    fact.errors += event.isError ? 1 : 0;
    fact.lastStatus = event.isError ? "error" : "ok";
    fact.truncated += wasTruncated(event.details) ? 1 : 0;
    fact.outputChars += event.content.reduce((total, item) => total + (item.type === "text" ? item.text.length : 0), 0);
  });

  pi.on("before_agent_start", () => {
    const prompt = factsPrompt();
    return prompt ? { systemPrompt: prompt } : undefined;
  });

  pi.registerTool({
    name: "improvement_suggestion",
    label: "Save Improvement Suggestion",
    description: "Save a redacted oh-my-pi improvement suggestion only after the user explicitly confirmed the edited content.",
    promptSnippet: "Save a user-confirmed improvement suggestion",
    promptGuidelines: [
      "Ask the user for confirmation before calling this tool.",
      "Pass confirmed=true only after the user confirms the exact edited content.",
      "Do not include a full transcript or unredacted secrets.",
    ],
    parameters: Type.Object({
      confirmed: Type.Boolean({ description: "Must be true only after explicit user confirmation." }),
      goal: Type.String({ description: "Concise user goal summary." }),
      capability: Type.Optional(Type.String()),
      tool: Type.Optional(Type.String()),
      skill: Type.Optional(Type.String()),
      extension: Type.Optional(Type.String()),
      parameters: Type.Optional(Type.Unknown()),
      evidence: Type.Optional(Type.String()),
      attempts: Type.Optional(Type.Array(Type.String())),
      gap: Type.Optional(Type.String()),
      recommendation: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      projectPath: Type.Optional(Type.String()),
    }),
    ...compactToolRenderers("improvement_suggestion", (args) => args?.tool ?? "suggestion"),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      if (!params.confirmed) return { content: [{ type: "text", text: "Suggestion was not saved: explicit user confirmation is required." }] };
      const context = contextFromParams(params, ctx.sessionManager.getSessionId());
      const key = issueKey(context);
      if (savedTaskIssues.has(key)) {
        return { content: [{ type: "text", text: "Suggestion was not saved: this issue was already recorded for the task or session." }] };
      }
      try {
        const saved = new ImprovementStore().save(context);
        savedTaskIssues.add(key);
        return { content: [{ type: "text", text: `Improvement suggestion saved: ${saved.id}` }], details: { id: saved.id, state: saved.state } };
      } catch (error) {
        return { content: [{ type: "text", text: `Improvement suggestion failed: ${(error as Error).message}` }], isError: true };
      }
    },
  });
}

export default registerImprovementDetection;
