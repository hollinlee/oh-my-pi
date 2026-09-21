export const RETRY_DELAYS_MS = [1_000, 2_000, 2_000, 5_000, 9_000, 20_000, 38_000, 38_000, 38_000, 40_000] as const;
export const MAX_RETRIES = RETRY_DELAYS_MS.length;

export const RUNTIME_STAGES = [
  "Waiting",
  "Analyzing",
  "Responding",
  "Running",
  "Retrying",
  "Compacting",
  "Summarizing",
  "Cancelling",
] as const;

export type RuntimeStage = typeof RUNTIME_STAGES[number];
export type RuntimeBucket = "waiting" | "analyzing" | "responding" | "executing" | "retrying" | "compacting" | "summarizing";
export type TerminalOutcome = "Done" | "Failed" | "Cancelled" | "Interrupted";

export type RuntimeTool = {
  id: string;
  summary: string;
  startedAt: number;
};

export type RetrySnapshot = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  until: number;
  error: string;
  providerRequested: boolean;
};

export type RuntimeState = {
  active: boolean;
  startedAt?: number;
  endedAt?: number;
  stage: RuntimeStage;
  stageDetail?: string;
  stageStartedAt?: number;
  totals: Record<RuntimeBucket, number>;
  tools: Record<string, RuntimeTool>;
  completedTools: number;
  failedTools: number;
  cancelledTools: number;
  retry?: RetrySnapshot;
  outcome?: TerminalOutcome;
};

const EMPTY_TOTALS: Record<RuntimeBucket, number> = {
  waiting: 0,
  analyzing: 0,
  responding: 0,
  executing: 0,
  retrying: 0,
  compacting: 0,
  summarizing: 0,
};

function bucketFor(stage: RuntimeStage): RuntimeBucket {
  if (stage === "Analyzing") return "analyzing";
  if (stage === "Responding") return "responding";
  if (stage === "Running") return "executing";
  if (stage === "Retrying") return "retrying";
  if (stage === "Compacting") return "compacting";
  if (stage === "Summarizing") return "summarizing";
  return "waiting";
}

function accrue(state: RuntimeState, now: number): RuntimeState {
  if (!state.active || state.stageStartedAt === undefined || now <= state.stageStartedAt) return state;
  const bucket = bucketFor(state.stage);
  return {
    ...state,
    totals: { ...state.totals, [bucket]: state.totals[bucket] + now - state.stageStartedAt },
    stageStartedAt: now,
  };
}

export function createRuntimeState(): RuntimeState {
  return {
    active: false,
    stage: "Waiting",
    totals: { ...EMPTY_TOTALS },
    tools: {},
    completedTools: 0,
    failedTools: 0,
    cancelledTools: 0,
  };
}

export function startRuntime(state: RuntimeState, now: number): RuntimeState {
  if (state.active) return state;
  return {
    ...createRuntimeState(),
    active: true,
    startedAt: now,
    stageStartedAt: now,
  };
}

export function transitionRuntime(state: RuntimeState, stage: RuntimeStage, now: number, detail?: string): RuntimeState {
  const active = startRuntime(state, now);
  const accrued = accrue(active, now);
  if (accrued.stage === stage && accrued.stageDetail === detail) return accrued;
  return {
    ...accrued,
    stage,
    stageDetail: detail,
    stageStartedAt: now,
    retry: stage === "Retrying" ? accrued.retry : undefined,
  };
}

export function startRuntimeTool(state: RuntimeState, id: string, summary: string, now: number): RuntimeState {
  const next = startRuntime(state, now);
  const tools = { ...next.tools, [id]: { id, summary, startedAt: now } };
  return transitionRuntime({ ...next, tools }, "Running", now, summary);
}

export function finishRuntimeTool(
  state: RuntimeState,
  id: string,
  now: number,
  outcome: "completed" | "failed" | "cancelled",
): RuntimeState {
  const accrued = accrue(state, now);
  const tools = { ...accrued.tools };
  delete tools[id];
  const remaining = Object.values(tools).at(-1);
  const next = {
    ...accrued,
    tools,
    completedTools: accrued.completedTools + (outcome === "completed" ? 1 : 0),
    failedTools: accrued.failedTools + (outcome === "failed" ? 1 : 0),
    cancelledTools: accrued.cancelledTools + (outcome === "cancelled" ? 1 : 0),
  };
  return transitionRuntime(next, remaining ? "Running" : "Waiting", now, remaining?.summary);
}

export function retryDelayMs(attempt: number, providerDelayMs?: number): number {
  if (providerDelayMs !== undefined && Number.isFinite(providerDelayMs) && providerDelayMs >= 0) return providerDelayMs;
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Math.floor(attempt) - 1));
  return RETRY_DELAYS_MS[index]!;
}

export function retryAttemptLabel(attempt: number): string {
  return `${Math.max(1, Math.min(MAX_RETRIES, Math.floor(attempt)))}/${MAX_RETRIES}`;
}

export function parseRetryAfterMs(headers: Record<string, string> | undefined, now = Date.now()): number | undefined {
  if (!headers) return undefined;
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1]?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function startRuntimeRetry(
  state: RuntimeState,
  attempt: number,
  error: string,
  now: number,
  providerDelayMs?: number,
): RuntimeState {
  const delayMs = retryDelayMs(attempt, providerDelayMs);
  const retry: RetrySnapshot = {
    attempt: Math.max(1, Math.min(MAX_RETRIES, Math.floor(attempt))),
    maxAttempts: MAX_RETRIES,
    delayMs,
    until: now + delayMs,
    error,
    providerRequested: providerDelayMs !== undefined,
  };
  return { ...transitionRuntime(state, "Retrying", now), retry };
}

export function settleRuntime(state: RuntimeState, outcome: TerminalOutcome, now: number): RuntimeState {
  const accrued = accrue(state, now);
  return {
    ...accrued,
    active: false,
    endedAt: now,
    stageStartedAt: undefined,
    stageDetail: undefined,
    retry: undefined,
    tools: {},
    outcome,
  };
}

export function runtimeTimings(state: RuntimeState, now = Date.now()): Record<RuntimeBucket | "total", number> {
  const current = accrue(state, now);
  const total = current.startedAt === undefined ? 0 : (current.endedAt ?? now) - current.startedAt;
  return { ...current.totals, total: Math.max(0, total) };
}

export function runtimeStageLabel(stage: string): RuntimeStage {
  const normalized = stage.trim().toLowerCase();
  if (normalized.includes("compact")) return "Compacting";
  if (normalized.includes("summar") || normalized.includes("branch")) return "Summarizing";
  if (normalized.includes("cancel")) return "Cancelling";
  if (normalized.includes("retry")) return "Retrying";
  if (normalized.includes("think") || normalized.includes("reason") || normalized.includes("analy")) return "Analyzing";
  if (normalized.includes("respond") || normalized.includes("answer") || normalized.includes("text")) return "Responding";
  if (normalized.includes("run") || normalized.includes("tool")) return "Running";
  return "Waiting";
}

export function terminalOutcome(stopReason: string | undefined, errorMessage?: string): TerminalOutcome {
  const normalized = (stopReason ?? "").toLowerCase();
  const error = (errorMessage ?? "").toLowerCase();
  if (normalized === "aborted" || normalized === "cancelled" || /\b(abort|aborted|cancel|cancelled)\b/.test(error)) return "Cancelled";
  if (normalized === "stop" || normalized === "tooluse") return "Done";
  if (normalized === "error") return "Failed";
  return "Interrupted";
}

export function turnSummaryLabel(stopReason: string | undefined, elapsed: string, errorMessage?: string): string {
  const outcome = terminalOutcome(stopReason, errorMessage);
  return `✻ ${outcome}${outcome === "Done" ? " in" : " after"} ${elapsed}`;
}
