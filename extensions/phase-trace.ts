import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export type PhaseStatus = "running" | "completed" | "failed" | "cancelled";

export type PhaseSnapshot = {
  id: string;
  name: string;
  status: PhaseStatus;
  actor: "main";
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
  | { type: "append-summary"; summary: string }
  | { type: "finish"; status: Exclude<PhaseStatus, "running">; now: number; summary?: string }
  | { type: "finish-turn"; now: number }
  | { type: "set-expanded"; expanded: boolean };

type TraceContext = Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">;

type TraceTheme = {
  fg?: (name: string, text: string) => string;
};

const WIDGET_KEY = "oh-my-pi.phase-trace";
const PHASE_TOOL = "phase_update";
export const PHASE_TRACE_ENABLED = process.env.OH_MY_PI_PHASE_TRACE_DISABLED !== "1";
const MAX_SUMMARIES = 8;
const MAX_SUMMARY_LENGTH = 160;
const TICK_MS = 1000;

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
  if (!/^[A-Za-z][A-Za-z0-9-]*(?: [A-Za-z][A-Za-z0-9-]*){0,2}$/.test(name)) {
    throw new Error("phase name must be 1-3 short English words");
  }
  return name;
}

function appendSummary(phase: PhaseSnapshot, summary: string | undefined): PhaseSnapshot {
  if (!summary) return phase;
  const text = inline(summary);
  if (!text) return phase;
  return { ...phase, summaries: [...phase.summaries, text].slice(-MAX_SUMMARIES) };
}

function finishActive(
  state: PhaseTraceState,
  status: Exclude<PhaseStatus, "running">,
  now: number,
  summary?: string,
): PhaseTraceState {
  if (!state.activePhaseId) return state;
  return {
    ...state,
    activePhaseId: undefined,
    expanded: status === "failed" ? true : state.expanded,
    phases: state.phases.map((phase) => phase.id === state.activePhaseId
      ? appendSummary({ ...phase, status, endedAt: now }, summary)
      : phase),
  };
}

export function applyPhaseTraceAction(state: PhaseTraceState, action: PhaseTraceAction): PhaseTraceState {
  if (action.type === "reset") {
    return { phases: [], expanded: false, turnStartedAt: action.now, nextId: 1 };
  }
  if (action.type === "set-expanded") return { ...state, expanded: action.expanded };
  if (action.type === "append-summary") {
    if (!state.activePhaseId) return state;
    return {
      ...state,
      phases: state.phases.map((phase) => phase.id === state.activePhaseId ? appendSummary(phase, action.summary) : phase),
    };
  }
  if (action.type === "finish") return finishActive(state, action.status, action.now, action.summary);
  if (action.type === "finish-turn") {
    const finished = finishActive(state, "completed", action.now);
    const hasFailure = finished.phases.some((phase) => phase.status === "failed");
    return { ...finished, expanded: hasFailure ? true : false, turnEndedAt: action.now };
  }

  const name = phaseName(action.name);
  let next = state;
  const active = state.phases.find((phase) => phase.id === state.activePhaseId);
  if (active?.implicit && active.summaries.length === 0) {
    next = { ...state, phases: state.phases.filter((phase) => phase.id !== active.id), activePhaseId: undefined };
  } else {
    next = finishActive(state, "completed", action.now);
  }
  const id = `phase-${next.nextId}`;
  const phase = appendSummary({
    id,
    name,
    status: "running",
    actor: "main",
    summaries: [],
    startedAt: action.now,
    implicit: action.implicit,
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
  if (phase.status === "running") return "●";
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

function phaseLine(phase: PhaseSnapshot, theme: TraceTheme, now: number): string {
  const elapsed = formatPhaseDuration(phase.startedAt, phase.endedAt ?? now);
  return `${tone(theme, statusTone(phase), icon(phase))} ${tone(theme, "accent", phase.name)}${tone(theme, "muted", ` · ${phase.actor} · ${elapsed}`)}`;
}

export function renderPhaseTraceLines(state: PhaseTraceState, theme: TraceTheme, width: number, now = Date.now()): string[] {
  const latest = state.phases.at(-1);
  if (!latest) {
    const elapsed = formatPhaseDuration(state.turnStartedAt ?? now, now);
    return [truncateToWidth(`${tone(theme, "dim", "○")} ${tone(theme, "muted", `Working · main · ${elapsed}`)}`, width, "")];
  }
  if (!state.expanded) return [truncateToWidth(phaseLine(latest, theme, now), width, tone(theme, "muted", "…"))];

  const lines: string[] = [];
  for (const phase of state.phases) {
    lines.push(truncateToWidth(phaseLine(phase, theme, now), width, tone(theme, "muted", "…")));
    for (const summary of phase.summaries) {
      lines.push(truncateToWidth(`  ${tone(theme, "dim", "›")} ${tone(theme, "muted", summary)}`, width, tone(theme, "muted", "…")));
    }
  }
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
  let timer: ReturnType<typeof setInterval> | undefined;

  const publish = (ctx: TraceContext | undefined = lastContext) => {
    if (!ctx?.hasUI) return;
    lastContext = ctx;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      invalidate() {},
      render(width: number) {
        return renderPhaseTraceLines(state, theme, width);
      },
    }), { placement: "belowEditor" });
  };

  const dispatch = (action: PhaseTraceAction, ctx?: TraceContext) => {
    state = applyPhaseTraceAction(state, action);
    publish(ctx);
  };

  pi.registerTool({
    name: PHASE_TOOL,
    label: "Phase update",
    description: "Start or finish a concise work phase shown in the phase trace below the editor.",
    promptSnippet: "Publish phase milestones with a 1-3 word English phase name",
    promptGuidelines: [
      "Use 1-3 short English words for phase names, such as Inspect, Implement, Build, Verify, or Review.",
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

  pi.registerShortcut("ctrl+o", {
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

  pi.on("session_start", (_event, ctx) => {
    lastContext = ctx;
    ctx.ui.setWorkingVisible(false);
    const active = new Set(pi.getActiveTools());
    active.add(PHASE_TOOL);
    pi.setActiveTools([...active]);
    state = initialPhaseTraceState();
    publish(ctx);
    if (timer) clearInterval(timer);
    timer = setInterval(() => publish(), TICK_MS);
    (timer as { unref?: () => void }).unref?.();
  });

  pi.on("input", (_event, ctx) => {
    lastContext = ctx;
    dispatch({ type: "reset", now: Date.now() }, ctx);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    lastContext = ctx;
    if (!state.activePhaseId) dispatch({ type: "start", name: "Working", now: Date.now(), implicit: true }, ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    if (toolName === PHASE_TOOL) return;
    lastContext = ctx;
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    dispatch({ type: "append-summary", summary: summarizeToolCall(toolName, (event as { args?: unknown }).args) }, ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    if (toolName === PHASE_TOOL) return;
    lastContext = ctx;
    const isError = (event as { isError?: boolean }).isError === true;
    const summary = summarizeToolResult(toolName, (event as { result?: unknown }).result, isError);
    if (!state.activePhaseId) state = applyPhaseTraceAction(state, { type: "start", name: "Working", now: Date.now(), implicit: true });
    if (isError) dispatch({ type: "finish", status: "failed", now: Date.now(), summary }, ctx);
    else dispatch({ type: "append-summary", summary }, ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    lastContext = ctx;
    dispatch({ type: "finish-turn", now: Date.now() }, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (ctx.hasUI) {
      ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "belowEditor" });
      ctx.ui.setWorkingVisible(true);
    }
    lastContext = undefined;
    state = initialPhaseTraceState();
  });
}
