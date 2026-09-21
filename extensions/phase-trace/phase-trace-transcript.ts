import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Image, Markdown, Text } from "@earendil-works/pi-tui";

export const TURN_TOOLS_ENTRY = "oh-my-pi.turn-tools";
export const TURN_RESULT_ENTRY = "oh-my-pi.turn-result";
export const TURN_SUMMARY_ENTRY = "oh-my-pi.turn-summary";
export const TURN_ENTRY_VERSION = 1;

export type TranscriptToolStatus = "completed" | "failed" | "cancelled";

export type TranscriptContent = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
};

export type TranscriptTool = {
  id: string;
  name: string;
  args: unknown;
  result?: {
    content: TranscriptContent[];
    details?: unknown;
    isError: boolean;
  };
  updates?: Array<{
    content: TranscriptContent[];
    details?: unknown;
  }>;
  status: TranscriptToolStatus;
  callSummary: string;
  resultSummary?: string;
};

export type TurnToolsEntry = {
  version: typeof TURN_ENTRY_VERSION;
  preamble: string[];
  tools: TranscriptTool[];
};

export type TurnResultEntry = {
  version: typeof TURN_ENTRY_VERSION;
  kind: "result" | "partial";
  text: string;
};

export type TurnSummaryEntry = {
  version: typeof TURN_ENTRY_VERSION;
  text: string;
  outcome: "Done" | "Failed" | "Cancelled" | "Interrupted";
  total: string;
};

export type TurnSurfaceEntry =
  | { customType: typeof TURN_TOOLS_ENTRY; data: TurnToolsEntry }
  | { customType: typeof TURN_RESULT_ENTRY; data: TurnResultEntry }
  | { customType: typeof TURN_SUMMARY_ENTRY; data: TurnSummaryEntry };

export function composeTurnSurfaceEntries(input: {
  tools: TranscriptTool[];
  preamble: string[];
  responseText: string;
  outcome: TurnSummaryEntry["outcome"];
  total: string;
  summaryText: string;
}): TurnSurfaceEntry[] {
  const entries: TurnSurfaceEntry[] = [];
  if (input.tools.length > 0) {
    entries.push({
      customType: TURN_TOOLS_ENTRY,
      data: { version: TURN_ENTRY_VERSION, preamble: [...input.preamble], tools: input.tools },
    });
  }
  if (input.responseText.trim()) {
    entries.push({
      customType: TURN_RESULT_ENTRY,
      data: {
        version: TURN_ENTRY_VERSION,
        kind: input.outcome === "Done" ? "result" : "partial",
        text: input.responseText.trim(),
      },
    });
  }
  entries.push({
    customType: TURN_SUMMARY_ENTRY,
    data: { version: TURN_ENTRY_VERSION, text: input.summaryText, outcome: input.outcome, total: input.total },
  });
  return entries;
}

type TranscriptTheme = {
  fg: (name: string, text: string) => string;
  bg?: (name: string, text: string) => string;
  bold?: (text: string) => string;
};

export function serializableTranscriptValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    return JSON.parse(JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "function" || typeof item === "symbol" || item === undefined) return undefined;
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }));
  } catch {
    return String(value ?? "");
  }
}

export function normalizeTranscriptResult(result: unknown, isError: boolean): TranscriptTool["result"] {
  const safe = serializableTranscriptValue(result);
  const record = safe && typeof safe === "object" ? safe as Record<string, unknown> : {};
  const content = Array.isArray(record.content)
    ? record.content.filter((item): item is TranscriptContent => Boolean(item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string"))
    : [];
  const details = record.details;
  const hasDetails = details !== undefined
    && (typeof details !== "object" || details === null || Array.isArray(details) || Object.keys(details as Record<string, unknown>).length > 0);
  return {
    content,
    ...(hasDetails ? { details } : {}),
    isError,
  };
}

export function transcriptUpdateSignature(result: Pick<NonNullable<TranscriptTool["result"]>, "content" | "details">): string {
  return JSON.stringify({ content: result.content, ...(result.details !== undefined ? { details: result.details } : {}) });
}

export function transcriptToolCounts(tools: TranscriptTool[]): Record<TranscriptToolStatus, number> {
  return tools.reduce<Record<TranscriptToolStatus, number>>((counts, tool) => {
    counts[tool.status] += 1;
    return counts;
  }, { completed: 0, failed: 0, cancelled: 0 });
}

function toolTitle(theme: TranscriptTheme, tool: TranscriptTool): string {
  const icon = tool.status === "completed" ? "✓" : tool.status === "failed" ? "✗" : "○";
  const tone = tool.status === "completed" ? "success" : tool.status === "failed" ? "error" : "warning";
  const callSummary = tool.callSummary.startsWith(`${tool.name} · `)
    ? tool.callSummary.slice(tool.name.length + 3)
    : tool.callSummary === tool.name ? "" : tool.callSummary;
  const summary = [callSummary, tool.resultSummary].filter(Boolean).join(" · ");
  return `${theme.fg(tone, icon)} ${theme.fg("toolTitle", theme.bold?.(tool.name) ?? tool.name)}${summary ? theme.fg("muted", ` · ${summary}`) : ""}`;
}

function jsonText(value: unknown, theme: TranscriptTheme): Text {
  return new Text(theme.fg("toolOutput", JSON.stringify(value, null, 2) ?? "null"), 0, 0);
}

function diffText(diff: string, theme: TranscriptTheme): Text {
  const styled = diff.split("\n").map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("success", line);
    if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("error", line);
    return theme.fg("toolOutput", line);
  }).join("\n");
  return new Text(styled, 0, 0);
}

function addResultContent(container: Container, tool: TranscriptTool, theme: TranscriptTheme): void {
  const result = tool.result;
  if (!result) return;
  const textBlocks = result.content.filter((item) => item.type === "text" && typeof item.text === "string");
  const imageBlocks = result.content.filter((item) => item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string");
  for (const item of textBlocks) {
    if (!item.text?.trim()) continue;
    container.addChild(new Markdown(item.text, 0, 0, getMarkdownTheme()));
  }
  for (const item of imageBlocks) {
    container.addChild(new Image(item.data!, item.mimeType!, {
      fallbackColor: (text) => theme.fg("dim", text),
    }, { maxWidthCells: 60 }));
  }
  const details = result.details && typeof result.details === "object" ? result.details as Record<string, unknown> : undefined;
  const diff = typeof details?.diff === "string" ? details.diff : undefined;
  if (diff) container.addChild(diffText(diff, theme));
  if (textBlocks.length === 0 && imageBlocks.length === 0 && !diff && result.details !== undefined) {
    container.addChild(jsonText(result.details, theme));
  }
}

export function renderTurnTools(data: TurnToolsEntry, expanded: boolean, theme: TranscriptTheme): Container | undefined {
  if (data.version !== TURN_ENTRY_VERSION || data.tools.length === 0) return undefined;
  const counts = transcriptToolCounts(data.tools);
  const stats = [
    `${counts.completed} completed`,
    counts.failed > 0 ? `${counts.failed} failed` : "",
    counts.cancelled > 0 ? `${counts.cancelled} cancelled` : "",
  ].filter(Boolean).join(" · ");
  const surface = new Container();
  surface.addChild(new Text(theme.fg("muted", `Tools · ${stats}`), 1, 0));
  const body = new Box(1, 0, (text) => theme.bg?.("toolPendingBg", text) ?? text);
  if (data.preamble.length > 0) body.addChild(new Markdown(data.preamble.join("\n\n"), 0, 0, getMarkdownTheme()));
  for (const tool of data.tools) {
    body.addChild(new Text(toolTitle(theme, tool), 0, 0));
    if (!expanded) continue;
    body.addChild(new Text(theme.fg("dim", "Call"), 0, 0));
    body.addChild(jsonText(tool.args, theme));
    for (const update of tool.updates ?? []) {
      body.addChild(new Text(theme.fg("dim", "Progress"), 0, 0));
      addResultContent(body, { ...tool, result: { ...update, isError: false } }, theme);
    }
    if (tool.result) {
      body.addChild(new Text(theme.fg("dim", "Result"), 0, 0));
      addResultContent(body, tool, theme);
    }
  }
  surface.addChild(body);
  return surface;
}

export function renderTurnResult(data: TurnResultEntry, theme: TranscriptTheme): Container | undefined {
  if (data.version !== TURN_ENTRY_VERSION || !data.text.trim()) return undefined;
  const surface = new Container();
  surface.addChild(new Text(theme.fg("muted", data.kind === "partial" ? "Partial response" : "Result"), 1, 0));
  const body = new Box(1, 0, (text) => theme.bg?.(data.kind === "partial" ? "toolPendingBg" : "customMessageBg", text) ?? text);
  body.addChild(new Markdown(data.text, 0, 0, getMarkdownTheme()));
  surface.addChild(body);
  return surface;
}

export function renderTurnSummary(data: TurnSummaryEntry, theme: TranscriptTheme): Text | undefined {
  if (data.version !== TURN_ENTRY_VERSION || !data.text.trim()) return undefined;
  return new Text(theme.fg("muted", data.text), 1, 0);
}
