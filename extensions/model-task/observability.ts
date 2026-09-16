import type { TaskCheckpoint, TaskEvent, TaskStatus } from "./schemas.ts";

export const MODEL_TASK_PROGRESS_INTERVAL_MS = 10 * 60 * 1000;
const MAX_SUMMARY = 180;
const AUTH_SECRET = /(\bauthorization\b\s*[:=]\s*)(?:bearer\s+)?([^\s,;]+)/gi;
const SECRET = /(\b(?:api[_-]?key|token|password|secret)\b\s*[:=]\s*)([^\s,;]+)/gi;
const KEY_MATERIAL = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
export type TaskProgressSnapshot = {
  taskId: string;
  goal: string;
  phase: string;
  status: TaskStatus;
  elapsedMs: number;
  risk: boolean;
  model?: { provider: string; name: string; role: string; source: string };
  recentEvents: Array<Pick<TaskEvent, "id" | "at" | "kind" | "summary">>;
  commandSummaries: string[];
  verification: Array<{ command: string; outcome: string; logPath?: string }>;
  logs: string[];
  final?: {
    summary: string;
    changes: string[];
    verification: string[];
    risks: string[];
    nextActions: string[];
  };
};

export type TaskProgressEffects = {
  snapshot: TaskProgressSnapshot;
  immediate: Array<{ level: "info" | "warning" | "error"; text: string }>;
  heartbeat?: string;
  terminal: boolean;
};

export function redactTaskDisplay(value: unknown, max = MAX_SUMMARY): string {
  const text = String(value ?? "")
    .replace(KEY_MATERIAL, "[REDACTED PRIVATE KEY]")
    .replace(AUTH_SECRET, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(SECRET, (_match, prefix: string) => `${prefix}[REDACTED]`);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function startedAt(checkpoint: TaskCheckpoint): number {
  const value = Date.parse(checkpoint.events[0]?.at ?? checkpoint.updatedAt);
  return Number.isFinite(value) ? value : Date.now();
}

function riskStatus(status: TaskStatus): boolean {
  return status === "blocked" || status === "needs_review" || status === "failed";
}

export function snapshotFromCheckpoint(checkpoint: TaskCheckpoint, now = Date.now()): TaskProgressSnapshot {
  const verification = (checkpoint.result?.verification ?? []).map((item) => ({
    command: redactTaskDisplay(item.command),
    outcome: redactTaskDisplay(item.outcome),
    ...(item.logPath ? { logPath: redactTaskDisplay(item.logPath) } : {}),
  }));
  const commandSummaries = checkpoint.events
    .filter((item) => item.kind === "tool" || typeof item.details?.command === "string")
    .slice(-8)
    .map((item) => redactTaskDisplay(item.details?.command ?? item.summary));
  const logs = verification.flatMap((item) => item.logPath ? [item.logPath] : []);
  const terminal = ["succeeded", "failed", "cancelled", "needs_review", "blocked"].includes(checkpoint.status);
  return {
    taskId: checkpoint.task.id,
    goal: redactTaskDisplay(checkpoint.task.goal),
    phase: redactTaskDisplay(checkpoint.phase, 80),
    status: checkpoint.status,
    elapsedMs: Math.max(0, now - startedAt(checkpoint)),
    risk: riskStatus(checkpoint.status) || checkpoint.events.some((item) => item.kind === "escalation"),
    ...(checkpoint.activeModel ? { model: {
      provider: redactTaskDisplay(checkpoint.activeModel.provider, 80),
      name: redactTaskDisplay(checkpoint.activeModel.model, 100),
      role: checkpoint.activeModel.role,
      source: checkpoint.activeModel.source,
    } } : {}),
    recentEvents: checkpoint.events.slice(-12).map((item) => ({ id: item.id, at: item.at, kind: item.kind, summary: redactTaskDisplay(item.summary) })),
    commandSummaries,
    verification,
    logs,
    ...(terminal && checkpoint.result ? { final: {
      summary: redactTaskDisplay(checkpoint.result.summary, 500),
      changes: checkpoint.result.changes.map((item) => `${redactTaskDisplay(item.path)}: ${redactTaskDisplay(item.summary)}`),
      verification: verification.map((item) => `${item.command}: ${item.outcome}`),
      risks: checkpoint.result.risks.map((item) => redactTaskDisplay(item)),
      nextActions: checkpoint.result.nextActions.map((item) => redactTaskDisplay(item)),
    } } : {}),
  };
}

function alertLevel(checkpoint: TaskCheckpoint, event: TaskEvent): "info" | "warning" | "error" | undefined {
  if (event.kind === "escalation") return "warning";
  if (event.kind === "status" && /approval|blocked|failed|needs.review/i.test(event.summary)) {
    return checkpoint.status === "failed" ? "error" : "warning";
  }
  return undefined;
}

export class TaskProgressTracker {
  private readonly notified = new Set<string>();
  private lastHeartbeatAt?: number;

  update(checkpoint: TaskCheckpoint, now = Date.now()): TaskProgressEffects {
    const snapshot = snapshotFromCheckpoint(checkpoint, now);
    const immediate: TaskProgressEffects["immediate"] = [];
    for (const item of checkpoint.events) {
      if (this.notified.has(item.id)) continue;
      this.notified.add(item.id);
      const level = alertLevel(checkpoint, item);
      if (level) immediate.push({ level, text: `${checkpoint.task.id} · ${checkpoint.status}: ${redactTaskDisplay(item.summary)}` });
    }
    if (this.lastHeartbeatAt === undefined) this.lastHeartbeatAt = now;
    const terminal = checkpoint.status !== "queued" && checkpoint.status !== "running";
    let heartbeat: string | undefined;
    if (!terminal && now - this.lastHeartbeatAt >= MODEL_TASK_PROGRESS_INTERVAL_MS) {
      heartbeat = `${snapshot.taskId} · ${snapshot.phase}/${snapshot.status} · ${formatElapsed(snapshot.elapsedMs)} · ${snapshot.model?.name ?? "model pending"}`;
      this.lastHeartbeatAt = now;
    }
    return { snapshot, immediate, ...(heartbeat ? { heartbeat } : {}), terminal };
  }
}

export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

export function formatTaskStatus(snapshot: TaskProgressSnapshot): string {
  const risk = snapshot.risk ? " ⚠" : "";
  return `${snapshot.taskId} · ${snapshot.phase}/${snapshot.status} · ${formatElapsed(snapshot.elapsedMs)}${risk} · ${snapshot.model?.name ?? "model pending"}`;
}

export function formatFinalReport(checkpoint: TaskCheckpoint): Record<string, unknown> {
  const snapshot = snapshotFromCheckpoint(checkpoint);
  return {
    taskId: snapshot.taskId,
    status: snapshot.status,
    summary: snapshot.final?.summary ?? snapshot.recentEvents.at(-1)?.summary ?? snapshot.goal,
    changes: snapshot.final?.changes ?? [],
    verification: snapshot.final?.verification ?? [],
    risks: snapshot.final?.risks ?? [],
    nextActions: snapshot.final?.nextActions ?? [],
    model: snapshot.model,
  };
}
