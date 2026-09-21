import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ImprovementStore } from "../improvements/store.ts";
import type { SubagentDetails, SubagentResult } from "./schemas.ts";

const recorded = new Set<string>();
const FAILURE_STATUSES = new Set<SubagentDetails["status"]>([
  "needs-context",
  "incomplete",
  "budget-exhausted",
  "tool-error",
  "runtime-error",
  "model-error",
]);

function bounded(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function resultEvidence(result: SubagentResult | undefined, details: Pick<SubagentDetails, "task" | "status" | "usage" | "stopReason">): string | undefined {
  const payload = {
    status: details.status,
    stopReason: details.stopReason,
    budget: details.task.budget ?? details.budget,
    capability: details.task.capability.profile,
    scope: {
      includePaths: details.task.scope.includePaths?.slice(0, 20) ?? [],
      excludePaths: details.task.scope.excludePaths?.slice(0, 20) ?? [],
    },
    usage: details.usage,
    result: result ? {
      summary: result.summary,
      hasEvidence: result.evidence.length > 0,
      hasVerification: result.verification.length > 0,
      hasChanges: result.changes.length > 0,
      evidence: result.evidence.slice(0, 8),
      verification: result.verification.slice(0, 8),
      risks: result.risks.slice(0, 8),
      remainingWork: result.remainingWork.slice(0, 8),
    } : undefined,
  };
  return bounded(JSON.stringify(payload), 8000);
}

export function resetSubagentImprovementRecords(): void {
  recorded.clear();
}

export function recordSubagentProblem(
  ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
  details: Pick<SubagentDetails, "task" | "status" | "budget" | "usage" | "stopReason" | "result">,
): string | undefined {
  if (!FAILURE_STATUSES.has(details.status)) return undefined;
  const summary = details.result?.summary ?? details.stopReason ?? `Subagent ended with ${details.status}`;
  const key = `${ctx.sessionManager.getSessionId()}:${details.task.id}:${details.status}:${summary}`;
  if (recorded.has(key)) return undefined;
  recorded.add(key);
  const saved = new ImprovementStore().save({
    goal: `Investigate subagent task failure: ${details.task.id}`,
    capability: "subagent",
    tool: "subagent",
    extension: "subagent",
    evidence: resultEvidence(details.result, details),
    attempts: [`status=${details.status}`, ...(details.stopReason ? [`stopReason=${bounded(details.stopReason, 1200)}`] : [])],
    gap: `Subagent task ended with ${details.status}.`,
    recommendation: "Use the bounded outcome telemetry to adjust scope, context, budget, retry policy, or parent takeover criteria before retrying.",
    sessionId: ctx.sessionManager.getSessionId(),
    taskId: details.task.id,
    projectPath: ctx.cwd,
  });
  return saved.id;
}

export function recordSubagentDispatchProblem(
  ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
  taskId: string,
  summary: string,
  gap = "Subagent dispatch was blocked before child startup.",
): string | undefined {
  const key = `${ctx.sessionManager.getSessionId()}:${taskId}:dispatch:${summary}`;
  if (recorded.has(key)) return undefined;
  recorded.add(key);
  const saved = new ImprovementStore().save({
    goal: `Investigate blocked subagent dispatch: ${taskId}`,
    capability: "subagent",
    tool: "subagent",
    extension: "subagent",
    evidence: bounded(summary, 4000),
    attempts: ["child session was not started"],
    gap,
    recommendation: "Inspect subagent configuration, model registry, sandbox support, and dispatch validation.",
    sessionId: ctx.sessionManager.getSessionId(),
    taskId,
    projectPath: ctx.cwd,
  });
  return saved.id;
}
