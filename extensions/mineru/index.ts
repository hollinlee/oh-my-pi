import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { compactToolRenderers } from "../compact-tool-renderer.ts";
import { parseWithMineru } from "./parse.ts";
import { sweepExpiredMineruJobs } from "./jobs.ts";
import {
  getMineruStatus,
  MINERU_API_BASE,
  MINERU_DISCLOSURE_LINES,
  MINERU_KEYCHAIN_SERVICE,
  revokeMineruAuthorization,
  setupMineruAuthorization,
  type MineruStatus,
} from "./config.ts";

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

const MINERU_TOOL = "mineru_parse";

function enableMineruTool(pi: ExtensionAPI): void {
  if (process.env.OH_MY_PI_MINERU_DISABLED === "1") return;
  const active = new Set(pi.getActiveTools());
  active.add(MINERU_TOOL);
  pi.setActiveTools([...active]);
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

  pi.registerTool({
    name: MINERU_TOOL,
    label: "MinerU Parse",
    description: "Upload one explicitly selected local document to MinerU Precision API, wait for parsing, and return a bounded preview plus a local Markdown result path.",
    promptSnippet: "Parse a local PDF, image, Word, PowerPoint, or Excel file with MinerU",
    promptGuidelines: [
      "Only call mineru_parse for a local file explicitly identified by the user.",
      "The file is uploaded to mineru.net and may be retained for up to 30 days.",
      "Use the returned resultPath for bounded searching; do not request or inject the entire Markdown document into context.",
      "MinerU spreadsheet parsing covers visible content, not workbook formulas, macros, hidden sheets, or named ranges.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Path to one local document explicitly selected by the user. Provide path or job_id, not both." })),
      job_id: Type.Optional(Type.String({ description: "Existing MinerU job ID to resume without uploading again." })),
      model: Type.Optional(StringEnum(["vlm", "pipeline"] as const, { description: "MinerU model. Defaults to vlm." })),
      ocr: Type.Optional(Type.Boolean({ description: "Whether to enable OCR. Images default to true; PDF and Office files default to false." })),
      language: Type.Optional(Type.String({ description: "MinerU language code. Defaults to ch." })),
      max_wait_seconds: Type.Optional(Type.Number({ description: "Maximum polling time. Defaults to 600 seconds and is capped at 1800." })),
    }),
    ...compactToolRenderers(MINERU_TOOL, (args) => args?.path ?? args?.job_id ?? "document"),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const result = await parseWithMineru(params, signal, {
          onState: (state) => onUpdate?.({
            content: [{ type: "text", text: `MinerU: ${state}` }],
            details: { state, path: params.path, job_id: params.job_id },
          }),
        });
        const text = result.status === "ready"
          ? [
              `MinerU status: ${result.status}`,
              `Job: ${result.jobId}`,
              `Batch: ${result.batchId}`,
              `Model: ${result.model}, OCR: ${result.ocr}, language: ${result.language}`,
              `Result: ${result.resultPath}`,
              `Characters: ${result.characters}`,
              `Local retention until: ${result.retentionUntil}`,
              ...(result.warning ? [`Warning: ${result.warning}`] : []),
              "",
              "Preview:",
              result.preview ?? "",
            ].join("\n")
          : [
              `MinerU status: ${result.status}`,
              `Stage: ${result.stage}`,
              `Category: ${result.category}`,
              `Code: ${result.code ?? "unknown"}`,
              `Job: ${result.jobId ?? "none"}`,
              `Batch: ${result.batchId ?? "unknown"}`,
              `Remote may continue: ${result.remoteMayContinue ? "yes" : "no"}`,
              `Error: ${result.error}`,
              ...(result.warning ? [`Warning: ${result.warning}`] : []),
              `Suggested action: ${result.suggestedAction}`,
            ].join("\n");
        return { content: [{ type: "text" as const, text }], details: result, isError: result.status !== "ready" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `MinerU parse failed: ${message}` }],
          details: { status: "failed", error: message },
          isError: true,
        };
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    enableMineruTool(pi);
    const sweep = await sweepExpiredMineruJobs();
    if (sweep.warnings.length) ctx.ui.notify(`MinerU cleanup warnings:\n${sweep.warnings.join("\n")}`, "warning");
  });

  pi.on("session_shutdown", async () => {
    await sweepExpiredMineruJobs();
  });
}
