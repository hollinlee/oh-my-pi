import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { usageIntakePath, writeUsageIntake } from "./intake.ts";
import { sessionsDir, usageStateDir } from "./paths.ts";
import { UsageDashboard } from "./usage-dashboard.ts";

export { sessionsDir, usageStateDir } from "./paths.ts";

type UsageSnapshot = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
};

function isPersisted(ctx: ExtensionContext): boolean {
  const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & { isPersisted?: () => boolean };
  return sessionManager.isPersisted?.() ?? ctx.sessionManager.getSessionFile() !== undefined;
}

function recordEphemeralUsage(
  ctx: ExtensionContext,
  operation: "assistant" | "toolResult" | "compaction" | "branch_summary",
  usage: UsageSnapshot | undefined,
  timestamp: string | number,
  eventKey: string,
  provider = "",
  model = "",
): void {
  if (isPersisted(ctx) || !usage) return;
  try {
    writeUsageIntake({
      timestamp: new Date(timestamp).toISOString(),
      operation,
      provider,
      model,
      projectPath: ctx.cwd,
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      cost: usage.cost.total,
      responses: operation === "assistant" ? 1 : 0,
      eventUid: `ephemeral:${ctx.sessionManager.getSessionId()}:${operation}:${eventKey}`,
    });
  } catch {
    // Usage accounting is best-effort and must not interrupt the active session.
  }
}

export default function usageExtension(pi: ExtensionAPI): void {
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role === "assistant") {
      recordEphemeralUsage(ctx, "assistant", message.usage, message.timestamp,
        `${message.timestamp}:${message.provider}:${message.model}`, message.provider, message.model);
    } else if (message.role === "toolResult") {
      recordEphemeralUsage(ctx, "toolResult", message.usage, message.timestamp,
        `${message.timestamp}:${message.toolCallId}`);
    }
  });

  pi.on("session_compact", (event, ctx) => {
    const entry = event.compactionEntry;
    recordEphemeralUsage(ctx, "compaction", entry.usage, entry.timestamp, entry.id);
  });

  pi.on("session_tree", (event, ctx) => {
    const entry = event.summaryEntry;
    if (entry) recordEphemeralUsage(ctx, "branch_summary", entry.usage, entry.timestamp, entry.id);
  });

  pi.registerCommand("usage", {
    description: "Open the persisted usage dashboard",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("The usage dashboard is available only in interactive TUI mode.", "warning");
        return;
      }
      await ctx.ui.custom((tui, theme, _keybindings, done) => new UsageDashboard(
        tui,
        theme,
        done,
        {
          stateDir: usageStateDir(),
          sessionsDir: sessionsDir(),
          intakePath: usageIntakePath(),
        },
      ));
    },
  });
}
