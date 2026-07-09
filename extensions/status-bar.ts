import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ToolSnapshot = {
  id: string;
  name: string;
  target?: string;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
};

type TimerSnapshot = {
  enabled: boolean;
  elapsed: string;
  stage: string;
};

type StepSnapshot = {
  text: string;
  expiresAt?: number;
};

type TokenTextCache = {
  key: string;
  text: string;
};

type FooterTheme = {
  rgb?: (hex: string, text: string) => string;
  fg?: (name: string, text: string) => string;
};

type StatusBarState = {
  enabled: boolean;
  footerInstalled: boolean;
  currentTool?: ToolSnapshot;
  latestTool?: ToolSnapshot;
  timer?: TimerSnapshot;
  explicitStep?: StepSnapshot;
  tokenTextCache?: TokenTextCache;
  toolCount: number;
  lastContext?: ExtensionContext;
  requestRender?: () => void;
};

type StepEvent = {
  text?: unknown;
  ttlMs?: unknown;
};

type StatusPublisherContext = Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">;

const MAX_TARGET_LENGTH = 48;
const MAX_STEP_LENGTH = 42;
const DEFAULT_STEP_TTL_MS = 12_000;
const BORDER_COLOR = "#7dd3fc";
const LABEL_COLOR = "#f9a8d4";
const VALUE_COLOR = "#d1fae5";
const DIM_COLOR = "#94a3b8";
const WARN_COLOR = "#fbbf24";
const ERROR_COLOR = "#f87171";

const state: StatusBarState = {
  enabled: process.env.OH_MY_PI_STATUS_BAR_DISABLED !== "1",
  footerInstalled: false,
  toolCount: 0,
};

let stepTimer: ReturnType<typeof setTimeout> | undefined;

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return sanitizeInline(value) || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function sanitizeInline(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").replace(/ +/g, " ").trim();
}

function truncate(value: string, max = MAX_TARGET_LENGTH): string {
  const compact = sanitizeInline(value);
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return "?";
  if (count < 1000) return String(Math.max(0, Math.round(count)));
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}m`;
}

function targetFromArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  if (toolName === "bash") return textOf(record.command)?.split("\n")[0];
  if (toolName === "read") return textOf(record.path);
  if (toolName === "write" || toolName === "edit") return textOf(record.path);
  if (toolName === "remote_exec" || toolName === "remote_exec_batch") return textOf(record.device) || textOf(record.command);
  if (toolName === "tavily_search") return textOf(record.query);
  if (toolName === "tavily_crawl") return textOf(record.url);
  if (toolName === "tavily_research") return textOf(record.input) || textOf(record.query);
  if (toolName === "tavily_extract") {
    const urls = record.urls;
    if (Array.isArray(urls)) return urls.map((url) => textOf(url)).filter(Boolean).join(", ");
    return textOf(record.url);
  }
  return textOf(record.path) || textOf(record.query) || textOf(record.command) || textOf(record.device);
}

function formatTool(tool: ToolSnapshot | undefined): string {
  if (!tool) return "idle";
  const icon = tool.status === "running" ? "run" : tool.status === "success" ? "ok" : "err";
  const target = tool.target ? ` ${truncate(tool.target)}` : "";
  return `${icon} ${tool.name}${target}`;
}

function activeToolText(): string {
  if (state.currentTool) return formatTool(state.currentTool);
  if (state.latestTool) return `last ${formatTool(state.latestTool)}`;
  return "idle";
}

function latestToolText(): string {
  return state.latestTool ? formatTool(state.latestTool) : "none";
}

function stepText(): string {
  const now = Date.now();
  if (state.explicitStep && (!state.explicitStep.expiresAt || state.explicitStep.expiresAt > now)) {
    return truncate(state.explicitStep.text, MAX_STEP_LENGTH);
  }
  if (state.currentTool) return `tool ${state.currentTool.name}`;
  if (state.timer?.enabled && state.timer.stage !== "idle") return state.timer.stage;
  return "ready";
}

function timerText(): string {
  if (!state.timer?.enabled) return "off";
  return `${state.timer.elapsed} ${truncate(state.timer.stage, 18)}`;
}

function modelText(ctx: ExtensionContext | undefined): string {
  return sanitizeInline(ctx?.model?.id || "no-model");
}

function cwdText(ctx: ExtensionContext | undefined): string {
  if (!ctx?.cwd) return "?";
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && ctx.cwd.startsWith(home)) return `~${ctx.cwd.slice(home.length) || "/"}`;
  return ctx.cwd;
}

function contextText(ctx: ExtensionContext | undefined): string {
  const usage = ctx?.getContextUsage?.();
  if (!usage) return "?";
  const window = formatCount(usage.contextWindow);
  if (usage.percent === null) return `?/${window}`;
  return `${usage.percent.toFixed(0)}%/${window}`;
}

function tokenText(ctx: ExtensionContext | undefined): string {
  const branch = ctx?.sessionManager.getBranch() ?? [];
  const sessionId = ctx?.sessionManager.getSessionId() ?? "none";
  const cacheKey = `${sessionId}:${branch.length}`;
  if (state.tokenTextCache?.key === cacheKey) return state.tokenTextCache.text;

  let input = 0;
  let output = 0;
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const usage = (entry.message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }).usage;
    input += usage?.input ?? 0;
    input += usage?.cacheRead ?? 0;
    input += usage?.cacheWrite ?? 0;
    output += usage?.output ?? 0;
  }

  const text = !input && !output ? "0" : `in ${formatCount(input)} out ${formatCount(output)}`;
  state.tokenTextCache = { key: cacheKey, text };
  return text;
}

function color(theme: FooterTheme, hex: string, fallback: string, text: string): string {
  return theme.rgb?.(hex, text) ?? theme.fg?.(fallback, text) ?? text;
}

function label(theme: FooterTheme, text: string): string {
  return color(theme, LABEL_COLOR, "accent", text);
}

function value(theme: FooterTheme, text: string, tone: "normal" | "dim" | "warn" | "error" = "normal"): string {
  if (tone === "dim") return color(theme, DIM_COLOR, "dim", text);
  if (tone === "warn") return color(theme, WARN_COLOR, "warning", text);
  if (tone === "error") return color(theme, ERROR_COLOR, "error", text);
  return color(theme, VALUE_COLOR, "success", text);
}

function segment(theme: FooterTheme, name: string, text: string, tone?: "normal" | "dim" | "warn" | "error"): string {
  return `${label(theme, name)} ${value(theme, text, tone)}`;
}

function frameLine(theme: FooterTheme, body: string, width: number): string {
  const left = color(theme, BORDER_COLOR, "accent", "┃ ");
  const right = color(theme, BORDER_COLOR, "accent", " ┃");
  const innerWidth = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
  const clipped = truncateToWidth(body, innerWidth, value(theme, "...", "dim"));
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
  return left + clipped + padding + right;
}

function footerLines(theme: FooterTheme, width: number): string[] {
  const ctx = state.lastContext;
  const line1 = [
    segment(theme, "MODEL", modelText(ctx)),
    segment(theme, "CWD", cwdText(ctx), "dim"),
    segment(theme, "CTX", contextText(ctx)),
    segment(theme, "TOKENS", tokenText(ctx), "dim"),
  ].join(value(theme, "  |  ", "dim"));
  const line2 = [
    segment(theme, "STEP", stepText()),
    segment(theme, "TOOL", activeToolText()),
    segment(theme, "TIMER", timerText(), state.timer?.enabled === false ? "dim" : "normal"),
    segment(theme, "LAST", latestToolText(), "dim"),
  ].join(value(theme, "  |  ", "dim"));
  return [frameLine(theme, line1, width), frameLine(theme, line2, width)];
}

function installFooter(ctx: StatusPublisherContext): void {
  if (!ctx.hasUI || state.footerInstalled) return;
  ctx.ui.setFooter((tui, theme, footerData) => {
    state.requestRender = () => tui.requestRender();
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    return {
      dispose() {
        unsubscribe();
        if (state.requestRender) state.requestRender = undefined;
      },
      invalidate() {},
      render(width: number): string[] {
        return footerLines(theme, width);
      },
    };
  });
  state.footerInstalled = true;
}

function uninstallFooter(ctx: StatusPublisherContext): void {
  if (!ctx.hasUI || !state.footerInstalled) return;
  ctx.ui.setFooter(undefined);
  state.footerInstalled = false;
  state.requestRender = undefined;
}

function publish(ctx: StatusPublisherContext | undefined = state.lastContext): void {
  if (!ctx?.hasUI) return;
  if (state.enabled) installFooter(ctx);
  else uninstallFooter(ctx);
  state.requestRender?.();
}

function reset(ctx?: ExtensionContext): void {
  state.currentTool = undefined;
  state.latestTool = undefined;
  state.toolCount = 0;
  state.explicitStep = undefined;
  if (stepTimer) clearTimeout(stepTimer);
  stepTimer = undefined;
  publish(ctx);
}

function setStep(payload: StepEvent): void {
  const text = textOf(payload.text);
  if (!text) return;
  if (stepTimer) clearTimeout(stepTimer);
  const ttlMs = typeof payload.ttlMs === "number" && payload.ttlMs > 0 ? payload.ttlMs : DEFAULT_STEP_TTL_MS;
  state.explicitStep = { text, expiresAt: Date.now() + ttlMs };
  stepTimer = setTimeout(() => {
    state.explicitStep = undefined;
    stepTimer = undefined;
    publish();
  }, ttlMs);
  (stepTimer as { unref?: () => void }).unref?.();
  publish();
}

export function updateTaskTimerFooter(snapshot: TimerSnapshot, ctx?: StatusPublisherContext): void {
  state.timer = {
    enabled: snapshot.enabled,
    elapsed: sanitizeInline(snapshot.elapsed),
    stage: sanitizeInline(snapshot.stage),
  };
  publish(ctx);
}

export function clearTaskTimerFooter(ctx?: StatusPublisherContext): void {
  state.timer = undefined;
  publish(ctx);
}

export function showOhMyPiStatusBar(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) return;
  const lines = [
    `Status: ${state.enabled ? "enabled" : "disabled"}`,
    `Footer: ${state.footerInstalled ? "installed" : "not installed"}`,
    `Step: ${stepText()}`,
    `Current tool: ${formatTool(state.currentTool)}`,
    `Latest tool: ${formatTool(state.latestTool)}`,
    `Timer: ${timerText()}`,
    `Tool calls this turn: ${state.toolCount}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export default function ohMyPiStatusBar(pi: ExtensionAPI): void {
  pi.registerCommand("status-bar", {
    description: "Show or toggle the oh-my-pi owned footer and tool activity summary",
    handler: async (args, ctx) => {
      state.lastContext = ctx;
      const action = String(args ?? "").trim().toLowerCase();
      if (action === "off") state.enabled = false;
      else if (action === "on") state.enabled = true;
      else if (action === "toggle") state.enabled = !state.enabled;
      else if (action && action !== "status") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /status-bar [status|on|off|toggle]", "warning");
        return;
      }
      publish(ctx);
      showOhMyPiStatusBar(ctx);
    },
  });

  pi.events.on("oh-my-pi:step", (payload) => setStep((payload ?? {}) as StepEvent));

  pi.on("session_start", (_event, ctx) => {
    state.lastContext = ctx;
    reset(ctx);
    publish(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (stepTimer) clearTimeout(stepTimer);
    stepTimer = undefined;
    uninstallFooter(ctx);
    state.currentTool = undefined;
    state.latestTool = undefined;
    state.timer = undefined;
    state.explicitStep = undefined;
    state.toolCount = 0;
    state.lastContext = undefined;
  });

  pi.on("input", (_event, ctx) => {
    state.lastContext = ctx;
    reset(ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    state.lastContext = ctx;
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    const snapshot: ToolSnapshot = {
      id: String((event as { toolCallId?: unknown }).toolCallId ?? `${Date.now()}`),
      name: toolName,
      target: targetFromArgs(toolName, (event as { args?: unknown }).args),
      status: "running",
      startedAt: Date.now(),
    };
    state.currentTool = snapshot;
    state.latestTool = snapshot;
    state.toolCount += 1;
    publish(ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    state.lastContext = ctx;
    const id = String((event as { toolCallId?: unknown }).toolCallId ?? "");
    const isCurrent = state.currentTool && (!id || state.currentTool.id === id);
    const finished = isCurrent ? state.currentTool : state.latestTool;
    if (finished) {
      finished.status = (event as { isError?: boolean }).isError ? "error" : "success";
      finished.endedAt = Date.now();
      state.latestTool = finished;
    }
    if (isCurrent) state.currentTool = undefined;
    publish(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    state.lastContext = ctx;
    state.currentTool = undefined;
    publish(ctx);
  });
}
