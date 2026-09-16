import type { ResolvedModel, TaskResult, TaskSpec } from "./schemas.ts";
import { redactTaskDisplay } from "./observability.ts";

export type EscalationReason =
  | "requirement_conflict"
  | "scope_change"
  | "architecture_change"
  | "api_change"
  | "data_format_change"
  | "security_risk"
  | "permission_risk"
  | "remote_high_risk"
  | "repeated_failure"
  | "acceptance_unmet";

export type EscalationRequest = {
  taskId: string;
  reasons: EscalationReason[];
  goal: string;
  acceptanceCriteria: string[];
  constraints: string[];
  scope: { cwd: string; includePaths: string[]; excludePaths: string[] };
  outcome: {
    status: string;
    summary: string;
    verification: string[];
    risks: string[];
    unresolved: string[];
  };
};

export type CollaborationResponse = {
  disposition: "correct" | "takeover" | "approve" | "changes_required" | "stop";
  summary: string;
  plan: string[];
  evidence: Array<{ claim: string; source: string }>;
  nextActions: string[];
  takeoverReason?: string;
};

export type CollaborationAdapter<Model> = (input: {
  kind: "advice" | "review";
  task: TaskSpec;
  model: Model;
  resolvedModel: ResolvedModel;
  request: EscalationRequest;
  signal?: AbortSignal;
}) => Promise<CollaborationResponse>;

const RULES: Array<[EscalationReason, RegExp]> = [
  ["requirement_conflict", /\b(?:conflict(?:ing)? requirement|contradict(?:ion|ory)|需求冲突|互相矛盾)\b/i],
  ["scope_change", /\b(?:out of scope|scope (?:change|expansion)|范围越界|扩大范围|超出范围)\b/i],
  ["architecture_change", /\b(?:architecture|architectural|核心架构|架构变更)\b/i],
  ["api_change", /\b(?:public api|breaking api|api change|公共\s*api|接口变更)\b/i],
  ["data_format_change", /\b(?:data (?:format|schema)|wire format|migration|数据格式|数据迁移)\b/i],
  ["security_risk", /\b(?:security|credential|secret|injection|安全风险|凭据|密钥)\b/i],
  ["permission_risk", /\b(?:permission|privilege|sudo|权限|提权)\b/i],
  ["remote_high_risk", /\b(?:remote high.?risk|production remote|远程高风险|生产环境)\b/i],
];
const MAX_ITEMS = 12;

function texts(task: TaskSpec, result?: TaskResult): string {
  return [
    task.goal,
    ...task.context,
    ...task.constraints,
    ...task.acceptanceCriteria,
    result?.summary,
    ...(result?.risks ?? []),
    ...(result?.unresolved ?? []),
    ...(result?.nextActions ?? []),
  ].filter(Boolean).join("\n");
}

export function escalationReasons(task: TaskSpec, status: string, result?: TaskResult, failedAttempts = 0): EscalationReason[] {
  const combined = texts(task, result);
  const reasons = RULES.filter(([, pattern]) => pattern.test(combined)).map(([reason]) => reason);
  if (failedAttempts >= 2) reasons.push("repeated_failure");
  if (status === "blocked" || status === "needs_review" || status === "failed" || (result?.unresolved.length ?? 0) > 0) reasons.push("acceptance_unmet");
  return [...new Set(reasons)];
}

export function requiresMandatoryReview(task: TaskSpec, result?: TaskResult): boolean {
  const reasons = escalationReasons(task, "succeeded", result);
  return reasons.some((reason) => ["architecture_change", "api_change", "data_format_change", "security_risk", "permission_risk", "remote_high_risk"].includes(reason));
}

export function minimalEscalationRequest(task: TaskSpec, status: string, result: TaskResult, reasons: EscalationReason[]): EscalationRequest {
  return {
    taskId: task.id,
    reasons,
    goal: redactTaskDisplay(task.goal, 500),
    acceptanceCriteria: task.acceptanceCriteria.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
    constraints: task.constraints.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
    scope: {
      cwd: redactTaskDisplay(task.scope.cwd),
      includePaths: task.scope.includePaths.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
      excludePaths: task.scope.excludePaths.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
    },
    outcome: {
      status,
      summary: redactTaskDisplay(result.summary, 500),
      verification: result.verification.slice(0, MAX_ITEMS).map((item) => `${redactTaskDisplay(item.command)}: ${redactTaskDisplay(item.outcome)}`),
      risks: result.risks.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
      unresolved: result.unresolved.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
    },
  };
}

export function correctionContext(response: CollaborationResponse): string {
  return [
    `Advanced model correction: ${redactTaskDisplay(response.summary, 500)}`,
    ...response.plan.slice(0, MAX_ITEMS).map((item) => `- ${redactTaskDisplay(item)}`),
  ].join("\n");
}

export function collaborationEventDetails(request: EscalationRequest, response?: CollaborationResponse): Record<string, unknown> {
  return {
    request,
    ...(response ? {
      response: {
        disposition: response.disposition,
        summary: redactTaskDisplay(response.summary, 500),
        plan: response.plan.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
        evidence: response.evidence.slice(0, MAX_ITEMS).map((item) => ({ claim: redactTaskDisplay(item.claim), source: redactTaskDisplay(item.source) })),
        nextActions: response.nextActions.slice(0, MAX_ITEMS).map((item) => redactTaskDisplay(item)),
        ...(response.takeoverReason ? { takeoverReason: redactTaskDisplay(response.takeoverReason) } : {}),
      },
    } : {}),
  };
}
