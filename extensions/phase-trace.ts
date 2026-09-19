import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

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
};

const WIDGET_KEY = "oh-my-pi.phase-trace";
const PHASE_TOOL = "phase_update";
const PHASE_TRACE_SHORTCUT = "ctrl+alt+o";
export const PHASE_TRACE_ENABLED = process.env.OH_MY_PI_PHASE_TRACE_DISABLED !== "1";
const MAX_SUMMARIES = 8;
const MAX_SUMMARY_LENGTH = 160;
const TICK_MS = 80;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
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

function compactPhaseLine(phase: PhaseSnapshot, theme: TraceTheme): string {
  return `${tone(theme, statusTone(phase), icon(phase))} ${tone(theme, "accent", phase.name)}`;
}

function realtimeLine(activity: RealtimeActivity, theme: TraceTheme, width: number, now: number): string | undefined {
  if (activity.kind === "idle") return undefined;
  const frame = tone(theme, "accent", SPINNER_FRAMES[Math.floor(now / TICK_MS) % SPINNER_FRAMES.length]!);
  const text = activity.kind === "working" ? "Working…" : `Running ${activity.summary}`;
  return truncateToWidth(`${frame} ${tone(theme, "muted", text)}`, width, tone(theme, "muted", "…"));
}

function subagentLine(child: SubagentSnapshot, theme: TraceTheme, now: number): string {
  const elapsed = child.startedAt === undefined ? "queued" : formatPhaseDuration(child.startedAt, child.endedAt ?? now);
  const childTone = child.status === "completed" ? "success" : child.status === "starting" || child.status === "running" || child.status === "pending" ? "accent" : "warning";
  return `  ${tone(theme, childTone, "↳")} ${tone(theme, "accent", child.taskId)}${tone(theme, "muted", ` · ${child.model} · ${child.status} · ${elapsed}`)}`;
}

export function renderPhaseTraceLines(state: PhaseTraceState, theme: TraceTheme, width: number, now = Date.now(), activity: RealtimeActivity = { kind: "idle" }): string[] {
  const visiblePhases = state.phases.filter((phase) => !phase.implicit);
  const latest = visiblePhases.at(-1);
  const currentStatus = realtimeLine(activity, theme, width, now);
  if (!state.expanded) {
    const lines: string[] = [];
    if (latest) lines.push(truncateToWidth(compactPhaseLine(latest, theme), width, tone(theme, "muted", "…")));
    if (currentStatus) lines.push(currentStatus);
    return lines;
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

function parseCommand(args: unknown): "status" | "expand" | "collapse" | "toggle" | undefined {
  const action = String(args ?? "status").trim().toLowerCase() || "status";
  return action === "status" || action === "expand" || action === "collapse" || action === "toggle" ? action : undefined;
}

export default function phaseTraceExtension(pi: ExtensionAPI): void {
  if (!PHASE_TRACE_ENABLED) return;

  let state = initialPhaseTraceState();
  let lastContext: TraceContext | undefined;
  let activity: RealtimeActivity = { kind: "idle" };
  let timer: ReturnType<typeof setInterval> | undefined;
  const toolPhases = new Map<string, string>();
  const subagentPhases = new Map<string, string>();

  const publish = (ctx: TraceContext | undefined = lastContext) => {
    if (!ctx?.hasUI) return;
    lastContext = ctx;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      invalidate() {},
      render(width: number) {
        return renderPhaseTraceLines(state, theme, width, Date.now(), activity);
      },
    }), { placement: "aboveEditor" });
  };

  const dispatch = (action: PhaseTraceAction, ctx?: TraceContext) => {
    state = applyPhaseTraceAction(state, action);
    publish(ctx);
  };

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
    description: "Show or toggle the current turn phase trace",
    handler: async (args, ctx) => {
      lastContext = ctx;
      const action = parseCommand(args);
      if (!action) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /work-trace [status|expand|collapse|toggle]", "warning");
        return;
      }
      if (action === "expand") dispatch({ type: "set-expanded", expanded: true }, ctx);
      else if (action === "collapse") dispatch({ type: "set-expanded", expanded: false }, ctx);
      else if (action === "toggle") dispatch({ type: "set-expanded", expanded: !state.expanded }, ctx);
      else if (ctx.hasUI) ctx.ui.notify(`Work trace: ${state.expanded ? "expanded" : "collapsed"} · ${state.phases.length} phase(s)`, "info");
    },
  });

  pi.registerShortcut(PHASE_TRACE_SHORTCUT, {
    description: "Expand or collapse the current turn phase trace",
    handler: async (ctx) => dispatch({ type: "set-expanded", expanded: !state.expanded }, ctx),
  });

  pi.events.on("oh-my-pi:phase-summary", (payload) => {
    const summary = inline(String((payload as { summary?: unknown } | undefined)?.summary ?? ""));
    if (!summary) return;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    dispatch({ type: "append-summary", summary });
  });

  const receiveCard = (payload: unknown) => {
    const event = (payload ?? {}) as { kind?: unknown; title?: unknown; detail?: unknown };
    const title = inline(String(event.title ?? ""));
    if (!title) return;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    const summary = [title, inline(String(event.detail ?? ""))].filter(Boolean).join(" · ");
    if (event.kind === "error") dispatch({ type: "finish", status: "failed", now: Date.now(), summary });
    else dispatch({ type: "append-summary", summary });
  };
  pi.events.on("oh-my-pi:phase-card", receiveCard);
  pi.events.on("oh-my-pi:card", receiveCard);

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
    activity = { kind: "idle" };
    publish(ctx);
    if (timer) clearInterval(timer);
    timer = setInterval(() => publish(), TICK_MS);
    (timer as { unref?: () => void }).unref?.();
  });

  pi.on("input", (_event, ctx) => {
    lastContext = ctx;
    toolPhases.clear();
    subagentPhases.clear();
    activity = { kind: "idle" };
    dispatch({ type: "reset", now: Date.now() }, ctx);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    lastContext = ctx;
    activity = { kind: "working" };
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    publish(ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    if (toolName === PHASE_TOOL) return;
    lastContext = ctx;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    activity = { kind: "tool", summary: summarizeToolCall(toolName, (event as { args?: unknown }).args) };
    const phaseId = state.activePhaseId;
    const toolCallId = String((event as { toolCallId?: unknown }).toolCallId ?? "");
    if (toolCallId && phaseId) toolPhases.set(toolCallId, phaseId);
    dispatch({ type: "append-summary", summary: summarizeToolCall(toolName, (event as { args?: unknown }).args), phaseId }, ctx);
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
    activity = isError ? { kind: "idle" } : { kind: "working" };
    if (isError) dispatch({ type: "finish", status: "failed", now: Date.now(), summary, phaseId }, ctx);
    else dispatch({ type: "append-summary", summary, phaseId }, ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    lastContext = ctx;
    activity = { kind: "idle" };
    dispatch({ type: "finish-turn", now: Date.now() }, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (ctx.hasUI) {
      ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
      ctx.ui.setWorkingIndicator(undefined);
      ctx.ui.setWorkingVisible(true);
    }
    toolPhases.clear();
    subagentPhases.clear();
    lastContext = undefined;
    activity = { kind: "idle" };
    state = initialPhaseTraceState();
  });
}
