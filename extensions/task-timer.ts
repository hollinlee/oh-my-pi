import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clearTaskTimerFooter, updateTaskTimerFooter } from "./status-bar";

type TimerPhase = "idle" | "running" | "paused";
type Stage = "waiting" | "thinking" | "answering" | "tool" | "working" | "paused" | "idle";

type TimerState = {
  enabled: boolean;
  phase: TimerPhase;
  stage: Stage;
  startedAt?: number;
  accumulatedMs: number;
  pausedReason?: string;
  currentTool?: string;
  lastContext?: StatusContext;
};

type StatusContext = Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">;

const TICK_MS = 1000;

const state: TimerState = {
  enabled: process.env.OH_MY_PI_TASK_TIMER_DISABLED !== "1",
  phase: "idle",
  stage: "idle",
  accumulatedMs: 0,
};

let tickTimer: ReturnType<typeof setInterval> | undefined;

function elapsedMs(now = Date.now()): number {
  if (state.phase === "running" && state.startedAt !== undefined) return state.accumulatedMs + (now - state.startedAt);
  return state.accumulatedMs;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stageText(): string {
  if (state.currentTool) return `tool ${state.currentTool}`;
  if (state.phase === "paused") return `paused${state.pausedReason ? ` (${state.pausedReason})` : ""}`;
  if (state.stage === "answering") return "answering";
  if (state.stage === "thinking") return "thinking";
  if (state.stage === "waiting") return "waiting";
  if (state.stage === "working") return "working";
  return state.phase;
}

function commandArgs(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function statusText(): string {
  return `oh-my-pi timer · ${formatDuration(elapsedMs())} · ${stageText()}`;
}

function publish(ctx: StatusContext | undefined = state.lastContext): void {
  updateTaskTimerFooter({ enabled: state.enabled, elapsed: formatDuration(elapsedMs()), stage: stageText() }, ctx);
}

function remember(ctx: StatusContext): void {
  state.lastContext = ctx;
}

function start(ctx?: StatusContext): void {
  state.phase = "running";
  state.stage = "working";
  state.startedAt = Date.now();
  state.accumulatedMs = 0;
  state.pausedReason = undefined;
  state.currentTool = undefined;
  publish(ctx);
}

function resume(ctx?: StatusContext): void {
  if (state.phase !== "paused") return;
  state.phase = "running";
  state.stage = "working";
  state.startedAt = Date.now();
  state.pausedReason = undefined;
  publish(ctx);
}

function pause(reason: string, ctx?: StatusContext): void {
  if (state.phase === "running") {
    state.accumulatedMs = elapsedMs();
    state.startedAt = undefined;
  }
  if (state.phase !== "idle") {
    state.phase = "paused";
    state.stage = "paused";
    state.pausedReason = reason;
  }
  publish(ctx);
}

function setStage(stage: Stage, ctx?: StatusContext): void {
  if (state.phase === "idle") return;
  if (state.phase === "paused") resume(ctx);
  state.stage = stage;
  publish(ctx);
}

function assistantEventStage(event: unknown): Stage | undefined {
  const type = String((event as { assistantMessageEvent?: { type?: unknown } })?.assistantMessageEvent?.type ?? "");
  if (type === "thinking_start" || type === "thinking_delta") return "thinking";
  if (type === "text_start" || type === "text_delta") return "answering";
  if (type === "toolcall_start" || type === "toolcall_delta" || type === "toolcall_end") return "tool";
  return undefined;
}

function toolName(event: unknown): string {
  const name = (event as { toolName?: unknown }).toolName;
  return typeof name === "string" && name.trim() ? name.trim() : "tool";
}

export function showTaskTimer(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) return;
  const lines = [
    `Status: ${state.enabled ? "enabled" : "disabled"}`,
    `Elapsed: ${formatDuration(elapsedMs())}`,
    `Stage: ${stageText()}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export default function taskTimer(pi: ExtensionAPI): void {
  pi.registerCommand("task-timer", {
    description: "Show or toggle the oh-my-pi task timer",
    handler: async (args, ctx) => {
      remember(ctx);
      const action = commandArgs(args).trim().toLowerCase();
      if (action === "off") state.enabled = false;
      else if (action === "on") state.enabled = true;
      else if (action === "toggle") state.enabled = !state.enabled;
      else if (action && action !== "status") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /task-timer [status|on|off|toggle]", "warning");
        return;
      }
      publish(ctx);
      showTaskTimer(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    remember(ctx);
    publish(ctx);
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => publish(), TICK_MS);
    (tickTimer as { unref?: () => void }).unref?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearTaskTimerFooter(ctx);
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = undefined;
    state.lastContext = undefined;
    state.phase = "idle";
    state.stage = "idle";
    state.accumulatedMs = 0;
    state.startedAt = undefined;
    state.currentTool = undefined;
  });

  pi.on("input", (_event, ctx) => {
    remember(ctx);
    start(ctx);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    remember(ctx);
    setStage("waiting", ctx);
  });

  pi.on("before_provider_request", (_event, ctx) => {
    remember(ctx);
    setStage("waiting", ctx);
  });

  pi.on("message_update", (event, ctx) => {
    remember(ctx);
    const stage = assistantEventStage(event);
    if (stage) setStage(stage, ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    remember(ctx);
    if (state.phase === "idle") start(ctx);
    state.currentTool = toolName(event);
    setStage("tool", ctx);
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    remember(ctx);
    state.currentTool = undefined;
    setStage("working", ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    remember(ctx);
    state.currentTool = undefined;
    pause("waiting for user", ctx);
  });
}
