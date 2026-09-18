import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  loadHookifyRules,
  matchingHookifyRules,
  selectHookifyRule,
  type HookifyDiagnostic,
  type HookifyRule,
} from "./rules.ts";

function short(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function ruleLabel(rule: HookifyRule): string {
  return `hookify rule ${rule.name}`;
}

function decisionMessage(rule: HookifyRule, command: string): string {
  return `${rule.message}\n\nCommand: ${short(command, 500)}`;
}

function reportDiagnostic(ctx: ExtensionContext, diagnostic: HookifyDiagnostic): void {
  const message = `[hookify] ignored ${diagnostic.filePath}: ${diagnostic.reason}`;
  if (ctx.hasUI) ctx.ui.notify(message, "warning");
  else console.warn(message);
}

function reportFailure(ctx: ExtensionContext, error: unknown): { block: true; reason: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const reason = `[hookify] failed closed while evaluating bash rules: ${detail}`;
  if (ctx.hasUI) ctx.ui.notify(reason, "error");
  else console.error(reason);
  return { block: true, reason };
}

export function registerHookify(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    if (!ctx.isProjectTrusted()) return;

    try {
      // Read on every call so a trusted project's next rule edit takes effect without reload.
      const loaded = loadHookifyRules(ctx.cwd);
      for (const diagnostic of loaded.diagnostics) reportDiagnostic(ctx, diagnostic);

      const command = event.input.command;
      const rule = selectHookifyRule(matchingHookifyRules(loaded.rules, command));
      if (!rule) return;

      const message = decisionMessage(rule, command);
      if (rule.action === "warn") {
        if (ctx.hasUI) ctx.ui.notify(`${ruleLabel(rule)} warning\n\n${message}`, "warning");
        else console.warn(`[hookify] ${ruleLabel(rule)} warning\n\n${message}`);
        return;
      }

      if (rule.action === "block") {
        return { block: true, reason: `${ruleLabel(rule)} blocked the bash command: ${rule.message}` };
      }

      // Confirmation must never turn into an implicit non-interactive allow.
      if (ctx.mode !== "tui") {
        return { block: true, reason: `${ruleLabel(rule)} requires interactive confirmation; non-TUI execution is blocked` };
      }
      const confirmed = await ctx.ui.confirm(ruleLabel(rule), message);
      if (!confirmed) return { block: true, reason: `${ruleLabel(rule)} was not confirmed` };
    } catch (error) {
      return reportFailure(ctx, error);
    }
  });
}

export default registerHookify;
