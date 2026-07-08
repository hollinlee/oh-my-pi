import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ToolSnapshot = {
  id: string;
  name: string;
  target?: string;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
};

type StatusBarState = {
  enabled: boolean;
  currentTool?: ToolSnapshot;
  latestTool?: ToolSnapshot;
  toolCount: number;
  lastContext?: ExtensionContext;
};

type StatusPublisherContext = Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">;

const STATUS_KEY = "oh-my-pi-status";
const MAX_TARGET_LENGTH = 48;

const state: StatusBarState = {
  enabled: process.env.OH_MY_PI_STATUS_BAR_DISABLED !== "1",
  toolCount: 0,
};

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function truncate(value: string, max = MAX_TARGET_LENGTH): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
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
  const icon = tool.status === "running" ? "…" : tool.status === "success" ? "✓" : "×";
  const target = tool.target ? ` ${truncate(tool.target)}` : "";
  return `${icon} ${tool.name}${target}`;
}

function statusText(): string {
  const active = state.currentTool ? formatTool(state.currentTool) : `last ${formatTool(state.latestTool)}`;
  return `oh-my-pi · tool ${active} · ${state.toolCount} calls`;
}

function publish(ctx: StatusPublisherContext | undefined = state.lastContext): void {
  if (!ctx?.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, state.enabled ? statusText() : undefined);
}

function reset(ctx?: ExtensionContext): void {
  state.currentTool = undefined;
  state.latestTool = undefined;
  state.toolCount = 0;
  publish(ctx);
}

export function showOhMyPiStatusBar(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) return;
  const lines = [
    `Status: ${state.enabled ? "enabled" : "disabled"}`,
    `Current tool: ${formatTool(state.currentTool)}`,
    `Latest tool: ${formatTool(state.latestTool)}`,
    `Tool calls this turn: ${state.toolCount}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export default function ohMyPiStatusBar(pi: ExtensionAPI): void {
  pi.registerCommand("status-bar", {
    description: "Show or toggle the oh-my-pi status bar and tool activity summary",
    handler: async (args, ctx) => {
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

  pi.on("session_start", (_event, ctx) => {
    state.lastContext = ctx;
    reset(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    state.currentTool = undefined;
    state.latestTool = undefined;
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
