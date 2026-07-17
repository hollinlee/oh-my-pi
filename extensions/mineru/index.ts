import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getMineruStatus,
  MINERU_API_BASE,
  MINERU_DISCLOSURE_LINES,
  MINERU_KEYCHAIN_SERVICE,
  revokeMineruAuthorization,
  setupMineruAuthorization,
  type MineruStatus,
} from "./config";

function statusText(status: MineruStatus): string {
  const state = status.disabled
    ? "disabled"
    : status.ready
      ? "ready"
      : status.authorized && !status.configured
        ? "not-configured"
        : status.configured && !status.authorized
          ? "authorization-required"
          : "not-configured";
  const lines = [
    `MinerU: ${state}`,
    `Service: ${MINERU_API_BASE}`,
    `Token: ${status.configured ? `${status.tokenSource}${status.tokenId ? ` (${status.tokenId})` : ""}` : "none"}`,
    `Cloud upload authorized: ${status.authorized ? "yes" : "no"}`,
    `Config: ${status.configPath}`,
  ];
  if (status.authorization) {
    lines.push(`Authorized at: ${status.authorization.authorizedAt}`);
    lines.push(`Disclosure: ${status.authorization.retentionDisclosure}`);
  }
  if (status.disabled) lines.push("Disabled by OH_MY_PI_MINERU_DISABLED=1");
  return lines.join("\n");
}

export async function showMineruStatus(ctx: ExtensionCommandContext): Promise<void> {
  const status = await getMineruStatus();
  ctx.ui.notify(statusText(status), status.ready ? "info" : "warning");
}

async function setupMineru(ctx: ExtensionCommandContext): Promise<void> {
  const current = await getMineruStatus();
  if (current.disabled) {
    ctx.ui.notify("MinerU is disabled by OH_MY_PI_MINERU_DISABLED=1.", "warning");
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Authorize MinerU cloud uploads?",
    MINERU_DISCLOSURE_LINES.join("\n"),
  );
  if (!confirmed) return;

  try {
    const status = await setupMineruAuthorization();
    const storageDetail = process.platform === "darwin"
      ? `Keychain service: ${MINERU_KEYCHAIN_SERVICE}`
      : "Token storage: MINERU_TOKEN environment variable (Keychain setup is macOS-only)";
    ctx.ui.notify(
      `MinerU configured. Token source: ${status.tokenSource}${status.tokenId ? ` (${status.tokenId})` : ""}.\n${storageDetail}`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify((error as Error).message, "error");
  }
}

async function revokeMineru(ctx: ExtensionCommandContext): Promise<void> {
  const current = await getMineruStatus();
  if (!current.authorized) {
    ctx.ui.notify("MinerU cloud upload authorization is already revoked.", "info");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Revoke MinerU cloud upload authorization?",
    "New MinerU parsing tasks will fail closed. Existing remote tasks may continue.",
  );
  if (!confirmed) return;

  let deleteKeychain = false;
  if (current.tokenSource === "keychain" || process.platform === "darwin") {
    deleteKeychain = await ctx.ui.confirm(
      "Delete MinerU token from Keychain?",
      `Delete service ${MINERU_KEYCHAIN_SERVICE}? Environment variable MINERU_TOKEN, if set, is not modified.`,
    );
  }
  const status = await revokeMineruAuthorization(deleteKeychain);
  ctx.ui.notify(
    `MinerU authorization revoked.${deleteKeychain ? " Keychain token deleted." : " Token was not deleted."}\n${statusText(status)}`,
    "info",
  );
}

export async function runMineruCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const action = args.trim().toLowerCase();
  if (!action) {
    const selected = await ctx.ui.select("MinerU", ["Setup", "Status", "Revoke"]);
    if (!selected) return;
    return runMineruCommand(selected.toLowerCase(), ctx);
  }
  if (action === "setup") return setupMineru(ctx);
  if (action === "status") return showMineruStatus(ctx);
  if (action === "revoke") return revokeMineru(ctx);
  ctx.ui.notify("Usage: /mineru setup | status | revoke", "warning");
}

export default function mineruExtension(pi: ExtensionAPI) {
  pi.registerCommand("mineru", {
    description: "Configure, inspect, or revoke MinerU cloud document parsing",
    getArgumentCompletions: (prefix) => {
      const values = ["setup", "status", "revoke"].filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return values.length ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => runMineruCommand(args, ctx),
  });
}
