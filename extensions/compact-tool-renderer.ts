import path from "node:path";
import os from "node:os";
import type { ExtensionAPI, ToolRenderContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, type Theme } from "@earendil-works/pi-tui";

export const COMPACT_TOOLS_ENABLED = process.env.OH_MY_PI_COMPACT_TOOLS_DISABLED !== "1";

const MAX_CALL_PREVIEW_CHARS = 120;
const MAX_ERROR_PREVIEW_CHARS = 1600;
const MAX_ERROR_PREVIEW_LINES = 12;

type BuiltInToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
type ToolResult = { content?: Array<{ type?: string; text?: string }>; details?: unknown };
type RenderContext = ToolRenderContext<any, any>;

type ToolDefinitionLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: any;
  prepareArguments?: (args: unknown) => any;
  executionMode?: "sequential" | "parallel";
  execute: (...args: any[]) => Promise<any>;
};

const factories: Record<BuiltInToolName, (cwd: string) => ToolDefinitionLike> = {
  read: createReadToolDefinition as (cwd: string) => ToolDefinitionLike,
  bash: createBashToolDefinition as (cwd: string) => ToolDefinitionLike,
  edit: createEditToolDefinition as (cwd: string) => ToolDefinitionLike,
  write: createWriteToolDefinition as (cwd: string) => ToolDefinitionLike,
  grep: createGrepToolDefinition as (cwd: string) => ToolDefinitionLike,
  find: createFindToolDefinition as (cwd: string) => ToolDefinitionLike,
  ls: createLsToolDefinition as (cwd: string) => ToolDefinitionLike,
};

const definitionCache = new Map<string, ToolDefinitionLike>();

function definitionFor(name: BuiltInToolName, cwd: string): ToolDefinitionLike {
  const key = `${name}\0${cwd}`;
  let definition = definitionCache.get(key);
  if (!definition) {
    definition = factories[name](cwd);
    definitionCache.set(key, definition);
  }
  return definition;
}

function sanitizeInline(value: unknown): string {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").replace(/ +/g, " ").trim();
}

function truncate(value: unknown, max = MAX_CALL_PREVIEW_CHARS): string {
  const text = sanitizeInline(value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function shortenPath(value: unknown): string {
  const text = String(value ?? "");
  const home = os.homedir();
  if (text === home) return "~";
  if (text.startsWith(`${home}${path.sep}`)) return `~${text.slice(home.length)}`;
  return text;
}

export function toolResultText(result: ToolResult): string {
  return (result.content ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n");
}

function resultHasImage(result: ToolResult): boolean {
  return (result.content ?? []).some((item) => item?.type === "image");
}

function lineCount(text: string): number {
  return text ? text.split(/\r?\n/).filter((line) => line.length > 0).length : 0;
}

function detailsRecord(result: ToolResult): Record<string, any> {
  return result.details && typeof result.details === "object" ? result.details as Record<string, any> : {};
}

function resultIsError(result: ToolResult, context?: RenderContext): boolean {
  const details = detailsRecord(result);
  return context?.isError === true || typeof details.error === "string";
}

function errorPreview(text: string): string {
  const lines = text.trim().split(/\r?\n/).slice(0, MAX_ERROR_PREVIEW_LINES);
  const preview = lines.join("\n") || "Tool failed without an error message.";
  return preview.length > MAX_ERROR_PREVIEW_CHARS ? `${preview.slice(0, MAX_ERROR_PREVIEW_CHARS - 1)}…` : preview;
}

function styledLines(theme: Theme, text: string, tone: "toolOutput" | "error"): string {
  return text.split(/\r?\n/).map((line) => theme.fg(tone, line)).join("\n");
}

function truncationSuffix(result: ToolResult): string {
  const truncation = detailsRecord(result).truncation;
  return truncation?.truncated ? " · truncated" : "";
}

function diffSummary(result: ToolResult): string | undefined {
  const diff = detailsRecord(result).diff;
  if (typeof diff !== "string" || !diff) return undefined;
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removals += 1;
  }
  return `applied · +${additions}/-${removals}`;
}

function successSummary(name: string, result: ToolResult): string {
  if (resultHasImage(result)) return "image loaded";
  if (name === "edit") return diffSummary(result) ?? "applied";
  if (name === "write") return "written";
  const count = lineCount(toolResultText(result));
  const unit = name === "grep" ? "matches" : name === "find" ? "files" : name === "ls" ? "entries" : "lines";
  return `done${count > 0 ? ` · ${count} ${unit}` : ""}${truncationSuffix(result)}`;
}

export function renderCompactToolCall(toolName: string, summary: unknown, theme: Theme): Text {
  const title = theme.fg("toolTitle", theme.bold(toolName));
  const detail = truncate(summary) || "…";
  return new Text(`${title} ${theme.fg("accent", detail)}`, 0, 0);
}

export function renderCompactToolResult(
  toolName: string,
  result: ToolResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  context?: RenderContext,
): Text {
  const text = toolResultText(result);
  const isError = resultIsError(result, context);

  if (options.isPartial) return new Text(theme.fg("warning", "running…"), 0, 0);

  if (isError) {
    const output = options.expanded ? text.trim() || "Tool failed without an error message." : errorPreview(text);
    return new Text(styledLines(theme, output, "error"), 0, 0);
  }

  if (!options.expanded) return new Text(theme.fg("muted", successSummary(toolName, result)), 0, 0);
  if (resultHasImage(result) && !text) return new Text(theme.fg("success", "image loaded"), 0, 0);
  if (!text.trim()) return new Text(theme.fg("muted", successSummary(toolName, result)), 0, 0);
  return new Text(`\n${styledLines(theme, text, "toolOutput")}`, 0, 0);
}

function builtInCallSummary(name: BuiltInToolName, args: Record<string, any>): string {
  if (name === "bash") return `$ ${truncate(args.command)}`;
  if (name === "read") {
    const range = args.offset !== undefined || args.limit !== undefined ? `:${args.offset ?? 1}${args.limit ? `+${args.limit}` : ""}` : "";
    return `${shortenPath(args.path)}${range}`;
  }
  if (name === "write") {
    const lines = typeof args.content === "string" ? args.content.split(/\r?\n/).length : 0;
    return `${shortenPath(args.path)}${lines ? ` · ${lines} lines` : ""}`;
  }
  if (name === "edit") return shortenPath(args.path);
  if (name === "grep") return `/${truncate(args.pattern)}/ · ${shortenPath(args.path ?? ".")}`;
  if (name === "find") return `${truncate(args.pattern)} · ${shortenPath(args.path ?? ".")}`;
  return shortenPath(args.path ?? ".");
}

export function compactToolRenderers(toolName: string, summarizeArgs: (args: any) => string) {
  if (!COMPACT_TOOLS_ENABLED) return {};
  return {
    renderCall(args: any, theme: Theme) {
      return renderCompactToolCall(toolName, summarizeArgs(args), theme);
    },
    renderResult(result: ToolResult, options: ToolRenderResultOptions, theme: Theme, context: RenderContext) {
      return renderCompactToolResult(toolName, result, options, theme, context);
    },
  };
}

function registerBuiltIn(pi: ExtensionAPI, name: BuiltInToolName): void {
  const seed = definitionFor(name, process.cwd());
  pi.registerTool({
    name: seed.name,
    label: seed.label,
    description: seed.description,
    promptSnippet: seed.promptSnippet,
    promptGuidelines: seed.promptGuidelines,
    parameters: seed.parameters,
    prepareArguments: seed.prepareArguments,
    executionMode: seed.executionMode,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return definitionFor(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme) {
      return renderCompactToolCall(name, builtInCallSummary(name, args as Record<string, any>), theme);
    },
    renderResult(result, options, theme, context) {
      return renderCompactToolResult(name, result as ToolResult, options, theme, context);
    },
  });
}

export default function compactToolRenderer(pi: ExtensionAPI): void {
  pi.registerCommand("compact-tools", {
    description: "Show or change compact tool transcript expansion",
    handler: async (args, ctx) => {
      const action = String(args ?? "status").trim().toLowerCase() || "status";
      if (action === "expand") ctx.ui.setToolsExpanded(true);
      else if (action === "collapse") ctx.ui.setToolsExpanded(false);
      else if (action === "toggle") ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
      else if (action !== "status") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /compact-tools [status|expand|collapse|toggle]", "warning");
        return;
      }
      if (ctx.hasUI) {
        const mode = COMPACT_TOOLS_ENABLED ? "enabled" : "disabled by OH_MY_PI_COMPACT_TOOLS_DISABLED=1";
        ctx.ui.notify(`Compact tools: ${mode}\nTool output: ${ctx.ui.getToolsExpanded() ? "expanded" : "collapsed"}`, "info");
      }
    },
  });

  if (!COMPACT_TOOLS_ENABLED) return;

  const registered = new Set(pi.getAllTools().map((tool) => tool.name));
  for (const name of Object.keys(factories) as BuiltInToolName[]) {
    if (registered.has(name)) registerBuiltIn(pi, name);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setToolsExpanded(false);
  });
}
