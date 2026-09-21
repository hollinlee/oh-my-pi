import { StringEnum } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  MAX_RETRIES,
  createRuntimeState,
  finishRuntimeTool,
  parseRetryAfterMs,
  retryAttemptLabel,
  runtimeTimings,
  settleRuntime,
  startRuntime,
  startRuntimeRetry,
  startRuntimeTool,
  terminalOutcome,
  transitionRuntime,
  turnSummaryLabel,
  type RuntimeState,
  type RuntimeStage,
} from "./phase-trace/phase-trace-runtime.ts";

export type PhaseStatus = "running" | "completed" | "failed" | "cancelled";

export type SubagentSnapshot = {
  taskId: string;
  status: string;
  model: string;
  startedAt?: number;
  endedAt?: number;
};

export type PhaseSnapshot = {
  id: string;
  name: string;
  status: PhaseStatus;
  actor: "main";
  subagents: SubagentSnapshot[];
  summaries: string[];
  startedAt: number;
  endedAt?: number;
  implicit?: boolean;
};

export type PhaseTraceState = {
  phases: PhaseSnapshot[];
  activePhaseId?: string;
  expanded: boolean;
  turnStartedAt?: number;
  turnEndedAt?: number;
  nextId: number;
};

export type PhaseTraceAction =
  | { type: "reset"; now: number }
  | { type: "start"; name: string; now: number; summary?: string; implicit?: boolean }
  | { type: "append-summary"; summary: string; phaseId?: string }
  | { type: "finish"; status: Exclude<PhaseStatus, "running">; now: number; summary?: string; phaseId?: string }
  | { type: "finish-turn"; now: number }
  | { type: "set-expanded"; expanded: boolean }
  | { type: "upsert-subagent"; phaseId: string; taskId: string; status: string; model: string; now: number; elapsedMs?: number };

type RealtimeActivity =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "tool"; summary: string };

type TraceContext = Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">;

type TraceTheme = {
  fg?: (name: string, text: string) => string;
  bg?: (name: string, text: string) => string;
};

const WIDGET_KEY = "oh-my-pi.phase-trace";
const PHASE_TOOL = "phase_update";
const TOOLS_MESSAGE = "oh-my-pi.turn-tools";
const RESULT_MESSAGE = "oh-my-pi.turn-result";
const SUMMARY_MESSAGE = "oh-my-pi.turn-summary";
export const PHASE_TRACE_ENABLED = process.env.OH_MY_PI_PHASE_TRACE_DISABLED !== "1";
const MAX_SUMMARIES = 8;
const MAX_SUMMARY_LENGTH = 160;
const TICK_MS = 80;
export const SPINNER_FRAMES = ["✻", "✽", "✳", "✽"] as const;
const CANONICAL_PHASES = new Set(["Inspect", "Plan", "Implement", "Verify", "Review", "Diagnose"]);

export function initialPhaseTraceState(): PhaseTraceState {
  return { phases: [], expanded: false, nextId: 1 };
}

function inline(value: string, max = MAX_SUMMARY_LENGTH): string {
  const text = value.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").replace(/ +/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return inline(String(value), 80) || undefined;
  if (!Array.isArray(value)) return undefined;
  const items = value.map(compactValue).filter((item): item is string => Boolean(item));
  return items.length > 0 ? items.slice(0, 3).join(", ") : undefined;
}

export function summarizeToolCall(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return toolName;
  const record = args as Record<string, unknown>;
  const keys = toolName === "bash"
    ? ["command"]
    : toolName.startsWith("remote_")
      ? ["device", "command", "path", "query"]
      : ["path", "query", "command", "url", "input", "name", "id"];
  for (const key of keys) {
    const text = compactValue(record[key]);
    if (text) return `${toolName} · ${text}`;
  }
  return toolName;
}

export function summarizeToolResult(toolName: string, result: unknown, isError: boolean): string {
  if (!result || typeof result !== "object") return `${isError ? "×" : "✓"} ${toolName}`;
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const contentText = content
    .map((item) => item && typeof item === "object" ? compactValue((item as { text?: unknown }).text) : undefined)
    .filter((item): item is string => Boolean(item))
    .join(" ");
  const details = record.details && typeof record.details === "object" ? record.details as Record<string, unknown> : {};
  const detail = contentText || ["summary", "message", "error", "status"]
    .map((key) => compactValue(details[key]))
    .find(Boolean);
  return `${isError ? "×" : "✓"} ${toolName}${detail ? ` · ${inline(detail, 96)}` : ""}`;
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => item && typeof item === "object" && (item as { type?: string }).type === "text"
    ? String((item as { text?: unknown }).text ?? "")
    : "").join("");
}

function messageLines(message: unknown): string[] {
  return messageText(message).split("\n").map((line) => inline(line, 180)).filter(Boolean);
}
function formatDoneTime(now = new Date()): string {
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatRuntimeDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function phaseName(value: string): string {
  const name = inline(value, 36);
  return CANONICAL_PHASES.has(name) ? name : "Working";
}

function appendSummary(phase: PhaseSnapshot, summary: string | undefined): PhaseSnapshot {
  if (!summary) return phase;
  const text = inline(summary);
  if (!text) return phase;
  return { ...phase, summaries: [...phase.summaries, text].slice(-MAX_SUMMARIES) };
}

function finishPhase(
  state: PhaseTraceState,
  status: Exclude<PhaseStatus, "running">,
  now: number,
  summary?: string,
  phaseId = state.activePhaseId,
): PhaseTraceState {
  if (!phaseId || !state.phases.some((phase) => phase.id === phaseId)) return state;
  return {
    ...state,
    activePhaseId: state.activePhaseId === phaseId ? undefined : state.activePhaseId,
    expanded: status === "failed" ? true : state.expanded,
    phases: state.phases.map((phase) => phase.id === phaseId
      ? appendSummary({ ...phase, status, endedAt: now }, summary)
      : phase),
  };
}

export function applyPhaseTraceAction(state: PhaseTraceState, action: PhaseTraceAction): PhaseTraceState {
  if (action.type === "upsert-subagent") {
    return {
      ...state,
      phases: state.phases.map((phase) => {
        if (phase.id !== action.phaseId) return phase;
        const existing = phase.subagents.find((child) => child.taskId === action.taskId);
        const isPending = action.status === "pending";
        const isActive = action.status === "starting" || action.status === "running";
        const startedAt = existing?.startedAt ?? (isPending
          ? undefined
          : action.elapsedMs !== undefined
            ? action.now - action.elapsedMs
            : action.now);
        const child: SubagentSnapshot = {
          taskId: action.taskId,
          status: action.status,
          model: action.model,
          startedAt,
          endedAt: isPending || isActive ? undefined : action.now,
        };
        return {
          ...phase,
          subagents: existing
            ? phase.subagents.map((item) => item.taskId === action.taskId ? child : item)
            : [...phase.subagents, child],
        };
      }),
    };
  }
  if (action.type === "reset") {
    return { phases: [], expanded: false, turnStartedAt: action.now, nextId: 1 };
  }
  if (action.type === "set-expanded") return { ...state, expanded: action.expanded };
  if (action.type === "append-summary") {
    const phaseId = action.phaseId ?? state.activePhaseId;
    if (!phaseId) return state;
    return {
      ...state,
      phases: state.phases.map((phase) => phase.id === phaseId ? appendSummary(phase, action.summary) : phase),
    };
  }
  if (action.type === "finish") return finishPhase(state, action.status, action.now, action.summary, action.phaseId);
  if (action.type === "finish-turn") {
    const finished = finishPhase(state, "completed", action.now);
    const hasFailure = finished.phases.some((phase) => phase.status === "failed");
    return { ...finished, expanded: hasFailure ? true : false, turnEndedAt: action.now };
  }

  const name = phaseName(action.name);
  let next = state;
  const active = state.phases.find((phase) => phase.id === state.activePhaseId);
  if (active?.implicit && active.summaries.length === 0) {
    next = { ...state, phases: state.phases.filter((phase) => phase.id !== active.id), activePhaseId: undefined };
  } else {
    next = finishPhase(state, "completed", action.now);
  }
  const id = `phase-${next.nextId}`;
  const phase = appendSummary({
    id,
    name,
    status: "running",
    actor: "main",
    subagents: [],
    summaries: [],
    startedAt: action.now,
    implicit: action.implicit || name === "Working",
  }, action.summary);
  return {
    ...next,
    phases: [...next.phases, phase],
    activePhaseId: id,
    turnStartedAt: next.turnStartedAt ?? action.now,
    turnEndedAt: undefined,
    nextId: next.nextId + 1,
  };
}

export function formatPhaseDuration(startedAt: number, endedAt: number): string {
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function tone(theme: TraceTheme, name: string, text: string): string {
  return theme.fg?.(name, text) ?? text;
}

function paddedRuntimeLine(body: string, theme: TraceTheme, width: number): string {
  if (width <= 0) return "";
  if (width === 1) return " ";
  return ` ${truncateToWidth(body, Math.max(0, width - 2), tone(theme, "muted", "…"))} `;
}

export function renderRuntimeStatusLines(
  runtime: RuntimeState,
  phase: string,
  theme: TraceTheme,
  width: number,
  now = Date.now(),
): string[] {
  if (!runtime.active) return [];
  const frameName = runtime.stage === "Retrying" || runtime.stage === "Cancelling" ? "warning" : "accent";
  const frame = tone(theme, frameName, SPINNER_FRAMES[Math.floor(now / TICK_MS) % SPINNER_FRAMES.length]!);
  const stageElapsed = runtime.stageStartedAt === undefined ? 0 : now - runtime.stageStartedAt;
  const total = runtime.startedAt === undefined ? 0 : now - runtime.startedAt;
  if (runtime.retry) {
    const retry = runtime.retry;
    const source = retry.providerRequested ? "Provider requested retry" : "Retrying";
    const first = `${frame} ${phase} · ${source} ${retryAttemptLabel(retry.attempt)} in ${formatRuntimeDuration(Math.max(0, retry.until - now))} · total ${formatRuntimeDuration(total)}`;
    const second = tone(theme, retry.providerRequested ? "warning" : "muted", retry.error);
    return [paddedRuntimeLine(first, theme, width), paddedRuntimeLine(second, theme, width)];
  }
  const detail = runtime.stageDetail ? ` ${runtime.stageDetail}` : "";
  const body = `${frame} ${phase} · ${runtime.stage}${detail} · ${formatRuntimeDuration(stageElapsed)} · total ${formatRuntimeDuration(total)}`;
  return [paddedRuntimeLine(body, theme, width)];
}

function icon(phase: PhaseSnapshot): string {
  if (phase.status === "running") return "○";
  if (phase.status === "completed") return "✓";
  if (phase.status === "failed") return "×";
  return "–";
}

function statusTone(phase: PhaseSnapshot): string {
  if (phase.status === "failed") return "error";
  if (phase.status === "cancelled") return "warning";
  if (phase.status === "completed") return "success";
  return "accent";
}

function subagentModelLabel(subagents: SubagentSnapshot[]): string {
  const models = [...new Set(subagents.map((child) => child.model))];
  if (models.length === 1) return models[0] ?? "unknown model";
  return `${models.length} models`;
}

function phaseActorLabel(phase: PhaseSnapshot): string {
  if (phase.subagents.length === 0) return phase.actor;
  return `subagents ${phase.subagents.length} · ${subagentModelLabel(phase.subagents)}`;
}

function phaseLine(phase: PhaseSnapshot, theme: TraceTheme, now: number): string {
  const elapsed = formatPhaseDuration(phase.startedAt, phase.endedAt ?? now);
  return `${tone(theme, statusTone(phase), icon(phase))} ${tone(theme, "accent", phase.name)}${tone(theme, "muted", ` · ${phaseActorLabel(phase)} · ${elapsed}`)}`;
}

function compactPhaseLine(phase: PhaseSnapshot, theme: TraceTheme, now: number): string {
  const elapsed = formatPhaseDuration(phase.startedAt, phase.endedAt ?? now);
  return `${tone(theme, statusTone(phase), icon(phase))} ${tone(theme, "accent", phase.name)}${tone(theme, "muted", ` · ${elapsed}`)}`;
}

function realtimeLine(activity: RealtimeActivity, theme: TraceTheme, width: number, now: number, phase?: PhaseSnapshot): string | undefined {
  if (activity.kind === "idle") return undefined;
  const frame = tone(theme, "accent", SPINNER_FRAMES[Math.floor(now / TICK_MS) % SPINNER_FRAMES.length]!);
  const text = activity.kind === "working" ? "Working" : `Running ${activity.summary}`;
  const phaseLabel = phase ? `${phase.name} · ` : "";
  return truncateToWidth(`${frame} ${tone(theme, "accent", phaseLabel)}${tone(theme, "muted", text)}`, width, tone(theme, "muted", "…"));
}

function subagentLine(child: SubagentSnapshot, theme: TraceTheme, now: number): string {
  const elapsed = child.startedAt === undefined ? "queued" : formatPhaseDuration(child.startedAt, child.endedAt ?? now);
  const childTone = child.status === "completed" ? "success" : child.status === "starting" || child.status === "running" || child.status === "pending" ? "accent" : "warning";
  return `  ${tone(theme, childTone, "↳")} ${tone(theme, "accent", child.taskId)}${tone(theme, "muted", ` · ${child.model} · ${child.status} · ${elapsed}`)}`;
}

export function renderPhaseTraceLines(state: PhaseTraceState, theme: TraceTheme, width: number, now = Date.now(), activity: RealtimeActivity = { kind: "idle" }): string[] {
  const visiblePhases = state.phases;
  const latest = visiblePhases.at(-1);
  const currentStatus = latest?.implicit && activity.kind === "working"
    ? realtimeLine(activity, theme, width, now)
    : realtimeLine(activity, theme, width, now, latest);
  if (!state.expanded) {
    if (currentStatus) return [currentStatus];
    return latest ? [truncateToWidth(compactPhaseLine(latest, theme, now), width, tone(theme, "muted", "…"))] : [];
  }

  const lines: string[] = [];
  for (const phase of visiblePhases) {
    lines.push(truncateToWidth(phaseLine(phase, theme, now), width, tone(theme, "muted", "…")));
    for (const child of phase.subagents) {
      lines.push(truncateToWidth(subagentLine(child, theme, now), width, tone(theme, "muted", "…")));
    }
    for (const summary of phase.summaries) {
      lines.push(truncateToWidth(`  ${tone(theme, "dim", "›")} ${tone(theme, "muted", summary)}`, width, tone(theme, "muted", "…")));
    }
  }
  if (currentStatus) lines.push(currentStatus);
  if (state.turnStartedAt !== undefined) {
    const total = formatPhaseDuration(state.turnStartedAt, state.turnEndedAt ?? now);
    lines.push(truncateToWidth(tone(theme, "dim", `  Total · ${total}`), width, ""));
  }
  return lines;
}

function parseCommand(args: unknown): "status" | undefined {
  const action = String(args ?? "status").trim().toLowerCase() || "status";
  return action === "status" ? action : undefined;
}

export default function phaseTraceExtension(pi: ExtensionAPI): void {
  if (!PHASE_TRACE_ENABLED) return;

  let state = initialPhaseTraceState();
  let lastContext: TraceContext | undefined;
  let runtime = createRuntimeState();
  let latestRuntime = createRuntimeState();
  let retryAttempt = 0;
  let pendingProviderDelayMs: number | undefined;
  let lastAgentMessages: unknown[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const toolPhases = new Map<string, string>();
  const subagentPhases = new Map<string, string>();
  const turnTools: Array<{ id: string; line: string }> = [];

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const currentPhaseName = () => state.phases.find((phase) => phase.id === state.activePhaseId)?.name
    ?? state.phases.at(-1)?.name
    ?? "Working";

  const publish = (ctx: TraceContext | undefined = lastContext) => {
    if (!ctx?.hasUI) return;
    lastContext = ctx;
    if (!runtime.active) {
      ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
      stopTimer();
      return;
    }
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      invalidate() {},
      render(width: number) {
        return renderRuntimeStatusLines(runtime, currentPhaseName(), theme, width);
      },
    }), { placement: "aboveEditor" });
    if (!timer) {
      timer = setInterval(() => publish(), TICK_MS);
      (timer as { unref?: () => void }).unref?.();
    }
  };

  const updateRuntime = (next: RuntimeState, ctx?: TraceContext) => {
    runtime = next;
    if (!next.active) latestRuntime = next;
    publish(ctx);
  };

  const transition = (stage: RuntimeStage, ctx?: TraceContext, detail?: string, now = Date.now()) => {
    updateRuntime(transitionRuntime(runtime, stage, now, detail), ctx);
  };

  const dispatch = (action: PhaseTraceAction, ctx?: TraceContext) => {
    state = applyPhaseTraceAction(state, action);
    publish(ctx);
  };

  const renderSurface = (title: string, body: string, theme: TraceTheme, markdown = false) => {
    const container = new Container();
    container.addChild(new Text(theme.fg?.("muted", title) ?? title, 1, 0));
    if (markdown) {
      container.addChild(new Markdown(body, 1, 0, getMarkdownTheme()));
    } else {
      const lines = body.split("\\n").map((line) => line).join("\\n");
      container.addChild(new Text(lines, 1, 0, (text) => theme.bg?.("toolPendingBg", text) ?? text));
    }
    return container;
  };

  pi.registerMessageRenderer(TOOLS_MESSAGE, (message, _options, theme) => {
    const details = message.details as { lines?: unknown[] } | undefined;
    const lines = Array.isArray(details?.lines) ? details.lines.map((line) => inline(String(line), 180)).filter(Boolean) : [];
    return renderSurface(`Tools · ${lines.length}`, lines.join("\\n"), theme);
  });
  pi.registerMessageRenderer(RESULT_MESSAGE, (message, _options, theme) => {
    return renderSurface("Result", messageText(message), theme, true);
  });
  pi.registerMessageRenderer(SUMMARY_MESSAGE, (message, _options, theme) => {
    return new Text(theme.fg("muted", messageText(message)), 1, 0);
  });
  pi.registerTool({
    name: PHASE_TOOL,
    label: "Phase update",
    description: "Start or finish a concise canonical work phase shown above the editor.",
    promptSnippet: "Publish canonical work phases",
    promptGuidelines: [
      "Use canonical phase names only: Inspect, Plan, Implement, Verify, Review, or Diagnose.",
      "Non-canonical names fall back to hidden Working status.",
      "Start a new phase only when the work objective changes; do not create a phase for every tool call.",
      "Finish the active phase with completed, failed, or cancelled before the final answer.",
    ],
    parameters: Type.Object({
      phase: Type.String({ description: "Phase name using 1-3 short English words." }),
      status: StringEnum(["start", "completed", "failed", "cancelled"] as const),
      summary: Type.Optional(Type.String({ description: "Optional concise progress or outcome summary." })),
    }),
    renderCall() {
      return { render: () => [], invalidate() {} };
    },
    renderResult() {
      return { render: () => [], invalidate() {} };
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const now = Date.now();
      if (params.status === "start") dispatch({ type: "start", name: params.phase, now, summary: params.summary }, ctx);
      else {
        const active = state.phases.find((phase) => phase.id === state.activePhaseId);
        const requestedName = phaseName(params.phase);
        if (!active) throw new Error(`cannot finish ${requestedName}: no phase is running`);
        if (active.name !== requestedName) throw new Error(`cannot finish ${requestedName}: active phase is ${active.name}`);
        dispatch({ type: "finish", status: params.status, now, summary: params.summary }, ctx);
      }
      return {
        content: [{ type: "text", text: `${params.phase}: ${params.status}` }],
        details: { phase: params.phase, status: params.status },
      };
    },
  });

  pi.registerCommand("work-trace", {
    description: "Show timing details for the current or latest turn",
    handler: async (args, ctx) => {
      lastContext = ctx;
      if (parseCommand(args) !== "status") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /work-trace", "warning");
        return;
      }
      const now = Date.now();
      const observed = runtime.active ? runtime : latestRuntime;
      const timings = runtimeTimings(observed, now);
      const phases = state.phases.map((phase) => `${phase.name} ${formatPhaseDuration(phase.startedAt, phase.endedAt ?? now)}`);
      const retry = observed.retry ? `Retry · ${retryAttemptLabel(observed.retry.attempt)} · ${formatRuntimeDuration(observed.retry.delayMs)}${observed.retry.providerRequested ? " provider" : " policy"}` : "Retry · none";
      const tools = `Tools · ${observed.completedTools} completed · ${observed.failedTools} failed · ${observed.cancelledTools} cancelled · ${Object.keys(observed.tools).length} active`;
      const buckets = [
        `Waiting ${formatRuntimeDuration(timings.waiting)}`,
        `Analyzing ${formatRuntimeDuration(timings.analyzing)}`,
        `Executing ${formatRuntimeDuration(timings.executing)}`,
        `Retrying ${formatRuntimeDuration(timings.retrying)}`,
        `Responding ${formatRuntimeDuration(timings.responding)}`,
        `Compacting ${formatRuntimeDuration(timings.compacting)}`,
        `Summarizing ${formatRuntimeDuration(timings.summarizing)}`,
      ].join(" · ");
      const subagents = state.phases.flatMap((phase) => phase.subagents.map((child) => `${child.taskId} · ${child.model} · ${child.status}`));
      if (ctx.hasUI) ctx.ui.notify([
        `Turn timing · ${formatRuntimeDuration(timings.total)} · ${observed.outcome ?? observed.stage}`,
        buckets,
        tools,
        retry,
        ...phases,
        ...subagents,
      ].join("\n"), "info");
    },
  });

  pi.events.on("oh-my-pi:phase-summary", (payload) => {
    const summary = inline(String((payload as { summary?: unknown } | undefined)?.summary ?? ""));
    if (!summary) return;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    dispatch({ type: "append-summary", summary });
  });

  pi.events.on("oh-my-pi:subagent-status", (payload) => {
    const event = (payload ?? {}) as { dispatchId?: unknown; taskId?: unknown; status?: unknown; model?: unknown; elapsedMs?: unknown };
    const dispatchId = inline(String(event.dispatchId ?? event.taskId ?? ""), 120);
    const taskId = inline(String(event.taskId ?? ""), 80);
    const status = inline(String(event.status ?? ""), 32);
    const model = inline(String(event.model ?? "unknown model"), 80);
    if (!taskId || !status) return;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    let phaseId = subagentPhases.get(dispatchId);
    if (!phaseId && state.activePhaseId) {
      phaseId = state.activePhaseId;
      subagentPhases.set(dispatchId, phaseId);
    }
    if (!phaseId) return;
    dispatch({
      type: "upsert-subagent",
      phaseId,
      taskId,
      status,
      model,
      now: Date.now(),
      elapsedMs: typeof event.elapsedMs === "number" ? event.elapsedMs : undefined,
    });
  });

  pi.on("session_start", (_event, ctx) => {
    lastContext = ctx;
    if (ctx.hasUI) {
      ctx.ui.setWorkingVisible(false);
      ctx.ui.setWorkingIndicator({ frames: [] });
    }
    const active = new Set(pi.getActiveTools());
    active.add(PHASE_TOOL);
    pi.setActiveTools([...active]);
    state = initialPhaseTraceState();
    runtime = createRuntimeState();
    latestRuntime = createRuntimeState();
    retryAttempt = 0;
    pendingProviderDelayMs = undefined;
    lastAgentMessages = [];
    stopTimer();
    publish(ctx);
  });

  pi.on("input", (_event, ctx) => {
    lastContext = ctx;
    const now = Date.now();
    if (!runtime.active) {
      toolPhases.clear();
      subagentPhases.clear();
      turnTools.length = 0;
      retryAttempt = 0;
      pendingProviderDelayMs = undefined;
      lastAgentMessages = [];
      state = applyPhaseTraceAction(state, { type: "reset", now });
      updateRuntime(startRuntime(createRuntimeState(), now), ctx);
    } else if (Object.keys(runtime.tools).length === 0 && !["Retrying", "Compacting", "Summarizing"].includes(runtime.stage)) {
      transition("Waiting", ctx, undefined, now);
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    lastContext = ctx;
    const now = Date.now();
    if (!runtime.active) updateRuntime(startRuntime(runtime, now), ctx);
    transition("Waiting", ctx, undefined, now);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    if (toolName === PHASE_TOOL) return;
    lastContext = ctx;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    const toolSummary = summarizeToolCall(toolName, (event as { args?: unknown }).args);
    const now = Date.now();
    const toolCallId = String((event as { toolCallId?: unknown }).toolCallId ?? "") || `${toolName}-${turnTools.length + 1}`;
    updateRuntime(startRuntimeTool(runtime, toolCallId, toolSummary, now), ctx);
    const phaseId = state.activePhaseId;
    if (phaseId) toolPhases.set(toolCallId, phaseId);
    turnTools.push({ id: toolCallId, line: toolSummary });
    dispatch({ type: "append-summary", summary: toolSummary, phaseId }, ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    if (toolName === PHASE_TOOL) return;
    lastContext = ctx;
    const toolCallId = String((event as { toolCallId?: unknown }).toolCallId ?? "");
    let phaseId = toolCallId ? toolPhases.get(toolCallId) : undefined;
    if (toolCallId) toolPhases.delete(toolCallId);
    if (!phaseId && !state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    phaseId ??= state.activePhaseId;
    const isError = (event as { isError?: boolean }).isError === true;
    const summary = summarizeToolResult(toolName, (event as { result?: unknown }).result, isError);
    const toolIndex = turnTools.findIndex((item) => item.id === toolCallId);
    if (toolIndex >= 0) turnTools[toolIndex] = { ...turnTools[toolIndex]!, line: `${turnTools[toolIndex]!.line}\\n  ${summary}` };
    else turnTools.push({ id: toolCallId || `${toolName}-${turnTools.length + 1}`, line: summary });
    const resultText = messageText((event as { result?: unknown }).result).toLowerCase();
    const toolOutcome = isError
      ? /abort|cancel|interrupt/.test(resultText) ? "cancelled" : "failed"
      : "completed";
    updateRuntime(finishRuntimeTool(runtime, toolCallId, Date.now(), toolOutcome), ctx);
    dispatch({ type: "append-summary", summary, phaseId }, ctx);
  });

  pi.on("message_update", (event, ctx) => {
    const messageEvent = (event as { assistantMessageEvent?: { type?: unknown } }).assistantMessageEvent;
    const kind = String(messageEvent?.type ?? "");
    if (kind === "thinking_start" || kind === "thinking_delta") transition("Analyzing", ctx);
    else if (kind === "text_start" || kind === "text_delta") transition("Responding", ctx);
  });

  pi.on("after_provider_response", (event, ctx) => {
    pendingProviderDelayMs = event.status >= 400 ? parseRetryAfterMs(event.headers) : undefined;
    lastContext = ctx;
  });

  pi.on("before_provider_request", (_event, ctx) => {
    if (runtime.active) transition("Waiting", ctx);
  });

  pi.on("message_end", (event, ctx) => {
    const message = event.message as { role?: string; stopReason?: string; errorMessage?: string; content?: unknown };
    if (message.role !== "assistant") return;
    lastContext = ctx;
    if (message.stopReason === "error") {
      retryAttempt = Math.min(MAX_RETRIES, retryAttempt + 1);
      const error = inline(String(message.errorMessage ?? "Provider error"), 160);
      updateRuntime(startRuntimeRetry(runtime, retryAttempt, error, Date.now(), pendingProviderDelayMs), ctx);
      pendingProviderDelayMs = undefined;
      return;
    }
    if (message.stopReason === "aborted" || message.stopReason === "cancelled") transition("Cancelling", ctx);
    else if (messageText(message).trim()) transition("Responding", ctx);
    retryAttempt = 0;
    pendingProviderDelayMs = undefined;
  });

  pi.on("agent_end", (event, ctx) => {
    lastContext = ctx;
    lastAgentMessages = (event as { messages?: unknown[] }).messages ?? [];
  });

  pi.on("agent_settled", (_event, ctx) => {
    lastContext = ctx;
    const now = Date.now();
    const finalAssistant = [...lastAgentMessages].reverse().find((message) => message && typeof message === "object" && (message as { role?: string }).role === "assistant");
    const assistant = finalAssistant as { stopReason?: string; errorMessage?: string } | undefined;
    const stopReason = String(assistant?.stopReason ?? "interrupted");
    const errorMessage = assistant?.errorMessage;
    const outcome = terminalOutcome(stopReason, errorMessage);
    const startedAt = runtime.startedAt;
    const total = formatRuntimeDuration(startedAt === undefined ? 0 : now - startedAt);
    if (turnTools.length > 0) {
      pi.sendMessage({
        customType: TOOLS_MESSAGE,
        content: turnTools.map((item) => item.line).join("\n"),
        display: true,
        details: { lines: turnTools.map((item) => item.line) },
      }, { triggerTurn: false });
    }
    const resultText = finalAssistant ? messageText(finalAssistant) : "";
    if (outcome === "Done" && resultText.trim()) {
      pi.sendMessage({
        customType: RESULT_MESSAGE,
        content: resultText,
        display: true,
        details: { markdown: true },
      }, { triggerTurn: false });
    }
    pi.sendMessage({
      customType: SUMMARY_MESSAGE,
      content: `${turnSummaryLabel(stopReason, total, errorMessage)} · ${formatDoneTime()}`,
      display: true,
      details: { total, label: outcome },
    }, { triggerTurn: false });
    updateRuntime(settleRuntime(runtime, outcome, now), ctx);
    dispatch({ type: "finish-turn", now }, ctx);
    retryAttempt = 0;
    pendingProviderDelayMs = undefined;
  });

  pi.on("session_before_compact", (_event, ctx) => {
    const now = Date.now();
    if (!runtime.active) updateRuntime(startRuntime(runtime, now), ctx);
    transition("Compacting", ctx, undefined, now);
  });

  pi.on("session_compact", (event, ctx) => {
    if (event.willRetry) transition("Waiting", ctx);
    else updateRuntime(settleRuntime(runtime, "Done", Date.now()), ctx);
  });

  pi.on("session_compact_failed", (event, ctx) => {
    updateRuntime(settleRuntime(runtime, event.aborted ? "Cancelled" : "Failed", Date.now()), ctx);
  });

  pi.on("session_before_tree", (event, ctx) => {
    if (!event.preparation.userWantsSummary) return;
    const now = Date.now();
    if (!runtime.active) updateRuntime(startRuntime(runtime, now), ctx);
    transition("Summarizing", ctx, undefined, now);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (runtime.active && runtime.stage === "Summarizing") updateRuntime(settleRuntime(runtime, "Done", Date.now()), ctx);
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    if (runtime.active) transition("Waiting", ctx, "for input");
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    if (runtime.active) transition("Waiting", ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    if (runtime.active) transition("Waiting", ctx, "provider fallback");
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopTimer();
    if (runtime.active) latestRuntime = settleRuntime(runtime, "Interrupted", Date.now());
    if (ctx.hasUI) {
      ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
      ctx.ui.setWorkingIndicator(undefined);
      ctx.ui.setWorkingVisible(true);
    }
    toolPhases.clear();
    subagentPhases.clear();
    lastContext = undefined;
    runtime = createRuntimeState();
    state = initialPhaseTraceState();
  });
}
