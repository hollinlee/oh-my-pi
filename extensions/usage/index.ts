import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scanSessions } from "./scanner.ts";
import { UsageStore } from "./store.ts";
import { formatTodaySummary, todayRange } from "./summary.ts";

export function usageStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OH_MY_PI_USAGE_STATE_DIR || join(homedir(), ".pi", "agent", "usage");
}

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_SESSIONS_DIR || join(homedir(), ".pi", "agent", "sessions");
}

export default function usageExtension(pi: ExtensionAPI): void {
  pi.registerCommand("usage", {
    description: "Show today's persisted Pi session usage",
    handler: async (_args, ctx) => {
      try {
        const store = new UsageStore(usageStateDir());
        try {
          scanSessions(store, sessionsDir());
          const range = todayRange();
          ctx.ui.notify(formatTodaySummary(store.totals(range.from, range.to)), "info");
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
