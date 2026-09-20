import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  classifyPermissionRisk,
  describePermissionRule,
  PermissionStore,
  type PermissionDescriptor,
  type PermissionRule,
  type PermissionRuleEffect,
  permissionStorePath,
} from "./rules.ts";

export { classifyPermissionRisk, describePermissionRule, PermissionStore, type PermissionDescriptor, type PermissionRule, type PermissionRuleEffect } from "./rules.ts";

export const PermissionDescriptorSchema = Type.Object({
  tool: Type.String(),
  action: Type.String(),
  target: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  host: Type.Optional(Type.String()),
  risk: Type.Optional(Type.String()),
  impact: Type.Optional(Type.Array(Type.String())),
  irreversible: Type.Optional(Type.Boolean()),
});

export const PermissionDecisionSchema = Type.Object({
  descriptor: PermissionDescriptorSchema,
  message: Type.Optional(Type.String()),
});

export interface PermissionDecision {
  effect: "allow" | "deny";
  remember: boolean;
  comment?: string;
}

function decisionOptions(descriptor: PermissionDescriptor): string[] {
  const risk = classifyPermissionRisk(descriptor);
  const remember = risk === "high" ? "Yes, and don't ask again (仅保存精确规则)" : "Yes, and don't ask again";
  return ["Yes", remember, "No"];
}

export async function requestPermission(ctx: ExtensionContext, descriptor: PermissionDescriptor, message: string): Promise<PermissionDecision> {
  if (ctx.mode !== "tui") return { effect: "deny", remember: false, comment: "interactive permission required" };
  const store = new PermissionStore();
  const existing = store.find(descriptor);
  if (existing) return { effect: existing.effect, remember: true };
  if (classifyPermissionRisk(descriptor) === "low") return { effect: "allow", remember: false };

  const selected = await ctx.ui.select("Permission request", [...decisionOptions(descriptor), "Cancel"]);
  if (!selected || selected === "Cancel") return { effect: "deny", remember: false };
  const isNo = selected === "No";
  const remember = selected.startsWith("Yes, and don't ask again");
  const comment = await ctx.ui.input(isNo ? "Why should this be changed? (optional)" : "Comment for the model (optional)");
  if (remember && !isNo) store.add("allow", descriptor);
  return { effect: isNo ? "deny" : "allow", remember, comment: comment || undefined };
}

function renderRules(rules: readonly PermissionRule[]): string[] {
  if (rules.length === 0) return ["No saved permission rules."];
  return rules.map((rule, index) => `${index + 1}. ${describePermissionRule(rule)}`);
}

async function managePermissions(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`Permission rules are available only in TUI mode. Store: ${permissionStorePath()}`, "warning");
    return;
  }
  const store = new PermissionStore();
  while (true) {
    const rules = store.list();
    const selected = await ctx.ui.select("Permissions", ["Create rule", ...renderRules(rules), "Close"]);
    if (!selected || selected === "Close") return;
    if (selected === "Create rule") {
      const effect = await ctx.ui.select("New rule effect", ["allow", "deny", "Back"]);
      if (effect !== "allow" && effect !== "deny") continue;
      const tool = await ctx.ui.input("Tool name");
      const action = await ctx.ui.input("Action");
      if (!tool || !action) continue;
      const target = await ctx.ui.input("Exact target (optional)");
      const cwd = await ctx.ui.input("Exact working directory (optional)");
      store.add(effect, { tool, action, target: target || undefined, cwd: cwd || undefined });
      ctx.ui.notify("Permission rule created.", "info");
      continue;
    }
    const index = Number.parseInt(selected.split(".", 1)[0] ?? "", 10) - 1;
    const rule = rules[index];
    if (!rule) continue;
    const action = await ctx.ui.select("Rule action", ["Narrow or edit", "Change allow/deny", "Revoke", "Back"]);
    if (!action || action === "Back") continue;
    if (action === "Revoke") {
      store.remove(rule.id);
      ctx.ui.notify(`Revoked ${rule.id}`, "info");
      continue;
    }
    if (action === "Change allow/deny") {
      const effect = await ctx.ui.select("Rule effect", ["allow", "deny"]);
      if (effect === "allow" || effect === "deny") store.update(rule.id, { effect });
      continue;
    }
    const target = await ctx.ui.input("Exact target (leave blank to keep current)", rule.descriptor.target);
    const cwd = await ctx.ui.input("Exact working directory (leave blank to keep current)", rule.descriptor.cwd);
    store.update(rule.id, { descriptor: { ...rule.descriptor, target: target || rule.descriptor.target, cwd: cwd || rule.descriptor.cwd } });
  }
}

export default function permissionsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("permissions", {
    description: "View and manage saved permission rules",
    handler: async (_args, ctx) => managePermissions(ctx),
  });
}
