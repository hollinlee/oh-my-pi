import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

type RtkStatus = {
  available: boolean;
  version?: string;
  detail?: string;
};

type ToolCallEvent = {
  toolName?: unknown;
  input?: { command?: unknown };
  args?: { command?: unknown };
};

const REWRITE_TIMEOUT_MS = 2_000;
const state = {
  suggestionsEnabled: process.env.OH_MY_PI_RTK_SUGGESTIONS_DISABLED !== "1",
  lastSuggestionKey: undefined as string | undefined,
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function commandFromEvent(event: ToolCallEvent): string | undefined {
  const command = event.input?.command ?? event.args?.command;
  return typeof command === "string" && command.trim() ? command : undefined;
}

function isBashToolCall(event: ToolCallEvent): boolean {
  return event.toolName === "bash";
}

function formatStatus(status: RtkStatus): string {
  const lines = [
    "RTK adapter",
    `rtk: ${status.available ? "available" : "unavailable"}${status.version ? ` (${status.version})` : ""}`,
    `suggestion mode: ${state.suggestionsEnabled ? "on" : "off"}`,
    "rewrite mode: off (suggestions only)",
  ];
  if (status.detail) lines.push(status.detail);
  lines.push("Commands: /rtk-adapter status | setup | suggestions on|off|toggle");
  return lines.join("\n");
}

async function getRtkStatus(pi: ExtensionAPI): Promise<RtkStatus> {
  try {
    const result = await pi.exec("rtk", ["--version"], { timeout: REWRITE_TIMEOUT_MS });
    if (result.code === 0) return { available: true, version: compact(result.stdout || result.stderr) };
    return { available: false, detail: compact(result.stderr || result.stdout || `exit ${result.code}`) };
  } catch (error) {
    return { available: false, detail: (error as Error).message };
  }
}

async function suggestRewrite(pi: ExtensionAPI, command: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!command.trim() || command.trim().startsWith("rtk ")) return undefined;

  const result = await pi.exec("rtk", ["rewrite", command], { timeout: REWRITE_TIMEOUT_MS, signal });
  if (result.killed || (result.code !== 0 && result.code !== 3)) return undefined;

  const suggested = result.stdout.trim();
  return suggested && suggested !== command ? suggested : undefined;
}

export async function showRtkAdapter(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const status = await getRtkStatus(pi);
  if (!ctx.hasUI) return;

  const setup = await ctx.ui.confirm("RTK adapter", `${formatStatus(status)}\n\nRun rtk init -g --agent pi? This writes global pi configuration.`);
  if (!setup) return;

  try {
    const result = await pi.exec("rtk", ["init", "-g", "--agent", "pi"], { timeout: 30_000 });
    if (result.code === 0) {
      ctx.ui.notify("rtk init -g --agent pi completed", "info");
      return;
    }
    ctx.ui.notify(`rtk init failed: ${result.stderr || result.stdout || `exit ${result.code}`}`, "error");
  } catch (error) {
    ctx.ui.notify(`rtk init failed: ${(error as Error).message}`, "error");
  }
}

async function showStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const status = await getRtkStatus(pi);
  if (ctx.hasUI) ctx.ui.notify(formatStatus(status), status.available ? "info" : "warning");
}

function setSuggestions(action: string): boolean | undefined {
  if (action === "on") return true;
  if (action === "off") return false;
  if (action === "toggle") return !state.suggestionsEnabled;
  return undefined;
}

export default function rtkAdapter(pi: ExtensionAPI): void {
  pi.registerCommand("rtk-adapter", {
    description: "Show RTK status, run setup, and control bash rewrite suggestions",
    handler: async (args, ctx) => {
      const parts = String(args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const [action = "status", value] = parts;

      if (action === "status") {
        await showStatus(pi, ctx);
        return;
      }
      if (action === "setup") {
        await showRtkAdapter(pi, ctx);
        return;
      }
      if (action === "suggestions") {
        const next = setSuggestions(value ?? "");
        if (next === undefined) {
          if (ctx.hasUI) ctx.ui.notify("Usage: /rtk-adapter suggestions [on|off|toggle]", "warning");
          return;
        }
        state.suggestionsEnabled = next;
        if (ctx.hasUI) ctx.ui.notify(`RTK suggestions ${next ? "enabled" : "disabled"}`, "info");
        return;
      }

      if (ctx.hasUI) ctx.ui.notify("Usage: /rtk-adapter [status|setup|suggestions on|off|toggle]", "warning");
    },
  });

  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    try {
      if (!state.suggestionsEnabled) return;
      const toolEvent = event as ToolCallEvent;
      if (!isBashToolCall(toolEvent)) return;

      const command = commandFromEvent(toolEvent);
      if (!command) return;

      const suggested = await suggestRewrite(pi, command, ctx.signal);
      if (!suggested) return;

      const key = `${command}\n${suggested}`;
      if (state.lastSuggestionKey === key) return;
      state.lastSuggestionKey = key;

      if (ctx.hasUI) ctx.ui.notify(`RTK suggestion (not applied):\n${suggested}`, "info");
    } catch (error) {
      console.warn("[oh-my-pi rtk-adapter] suggestion failed open:", error);
    }
  });
}
