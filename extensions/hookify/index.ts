import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { requestPermission } from "../permissions/index.ts";
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
      if (loaded.overflow) {
        return { block: true, reason: "[hookify] rule set is incomplete; refusing to run bash until the rule directory is reduced" };
      }

      const command = typeof event.input?.command === "string"
        ? event.input.command
        : typeof (event as { args?: { command?: unknown } }).args?.command === "string"
          ? (event as { args: { command: string } }).args.command
          : undefined;
      if (!command) return reportFailure(ctx, new Error("bash tool call did not contain a command string"));
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
      const decision = await requestPermission(ctx, {
        tool: event.toolName,
        action: command,
        target: command,
        cwd: ctx.cwd,
        risk: "high",
        impact: ["execute-command"],
        irreversible: /\b(?:rm|delete|deploy|push|sudo)\b/i.test(command),
      }, message);
      if (decision.effect === "allow") return;
      return { block: true, reason: `${ruleLabel(rule)} was not confirmed${decision.comment ? `: ${decision.comment}` : ""}` };
    } catch (error) {
      return reportFailure(ctx, error);
    }
  });
}

export default registerHookify;
