import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { importUsageIntake, usageIntakePath, writeUsageIntake } from "./intake.ts";
import { sessionsDir, usageStateDir } from "./paths.ts";
import { scanSessions } from "./scanner.ts";
import { UsageStore } from "./store.ts";
import { formatTodaySummary, todayRange } from "./summary.ts";

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
    description: "Show today's persisted Pi session usage",
    handler: async (_args, ctx) => {
      try {
        const store = new UsageStore(usageStateDir());
        try {
          scanSessions(store, sessionsDir());
          const intake = importUsageIntake(store, usageIntakePath());
          const range = todayRange();
          ctx.ui.notify(formatTodaySummary(store.totals(range.from, range.to)), "info");
          if (intake.errors.length > 0) {
            ctx.ui.notify(`Skipped ${intake.errors.length} invalid usage intake record(s).`, "warning");
          }
        } finally {
          store.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Usage ledger unavailable: ${message}`, "error");
      }
    },
  });
}
