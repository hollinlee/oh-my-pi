import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ToolSnapshot = {
  id: string;
  name: string;
  target?: string;
  detail?: string;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
};

type TimerSnapshot = {
  enabled: boolean;
  elapsed: string;
  stage: string;
};

type StepSnapshot = {
  text: string;
  expiresAt?: number;
};

type WorkflowCardKind = "success" | "info" | "warning" | "error";

type WorkflowCardSnapshot = {
  kind: WorkflowCardKind;
  title: string;
  detail?: string;
  meta: string[];
  createdAt: number;
  expiresAt?: number;
};

type WorkflowCardEvent = {
  kind?: unknown;
  title?: unknown;
  detail?: unknown;
  meta?: unknown;
  ttlMs?: unknown;
};

type DetailLaneTone = "normal" | "dim" | "warn" | "error";

type DetailLaneSnapshot = {
  source: string;
  summary: string;
  info: string;
  lines: string[];
  expanded: boolean;
  tone: DetailLaneTone;
};

type DetailLaneEvent = {
  source?: unknown;
  summary?: unknown;
  info?: unknown;
  lines?: unknown;
  expanded?: unknown;
  tone?: unknown;
};

type TokenTextCache = {
  key: string;
  text: string;
};

type CachedFooterContext = {
  modelName?: string;
  modelId?: string;
  provider?: string;
  cwd?: string;
  contextUsage?: string;
  tokens?: string;
};

type FooterTheme = {
  rgb?: (hex: string, text: string) => string;
  fg?: (name: string, text: string) => string;
};

type StatusBarState = {
  enabled: boolean;
  footerInstalled: boolean;
  currentTool?: ToolSnapshot;
  latestTool?: ToolSnapshot;
  timer?: TimerSnapshot;
  explicitStep?: StepSnapshot;
  workflowCard?: WorkflowCardSnapshot;
  detailLane?: DetailLaneSnapshot;
  tokenTextCache?: TokenTextCache;
  cachedContext: CachedFooterContext;
  toolCount: number;
  lastContext?: ExtensionContext;
  requestRender?: () => void;
};

type StepEvent = {
  text?: unknown;
  ttlMs?: unknown;
};

type StatusPublisherContext = Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">;

const MAX_TARGET_LENGTH = 48;
const MAX_STEP_LENGTH = 42;
const MAX_CARD_TITLE_LENGTH = 64;
const MAX_CARD_DETAIL_LENGTH = 72;
const MAX_CARD_META_ITEMS = 4;
const MAX_DETAIL_SUMMARY_LENGTH = 120;
const FOOTER_LABEL_WIDTH = 7;
const FOOTER_COLUMN_GAP = 2;
const detailMaxLinesEnv = Number(process.env.OH_MY_PI_DETAIL_MAX_LINES);
const MAX_DETAIL_LINES = Math.max(1, Math.min(12, Number.isFinite(detailMaxLinesEnv) ? detailMaxLinesEnv : 8));
const DEFAULT_STEP_TTL_MS = 12_000;
const DEFAULT_CARD_TTL_MS = 10_000;
const WORKFLOW_CARD_WIDGET_KEY = "oh-my-pi.workflow-card";
const BORDER_COLOR = "#7dd3fc";
const LABEL_COLOR = "#f9a8d4";
const VALUE_COLOR = "#d1fae5";
const DIM_COLOR = "#94a3b8";
const WARN_COLOR = "#fbbf24";
const ERROR_COLOR = "#f87171";
const SUCCESS_COLOR = "#34d399";
const INFO_COLOR = "#60a5fa";

const state: StatusBarState = {
  enabled: process.env.OH_MY_PI_STATUS_BAR_DISABLED !== "1",
  footerInstalled: false,
  cachedContext: {},
  toolCount: 0,
};

let stepTimer: ReturnType<typeof setTimeout> | undefined;
let cardTimer: ReturnType<typeof setTimeout> | undefined;

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return sanitizeInline(value) || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function sanitizeInline(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").replace(/ +/g, " ").trim();
}

function truncate(value: string, max = MAX_TARGET_LENGTH): string {
  const compact = sanitizeInline(value);
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return "?";
  if (count < 1000) return String(Math.max(0, Math.round(count)));
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}m`;
}

function compactValue(value: unknown): string | undefined {
  const scalar = textOf(value);
  if (scalar) return scalar;
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((item): item is string => Boolean(item));
    if (items.length > 0) return items.slice(0, 3).join(", ") + (items.length > 3 ? ` +${items.length - 3}` : "");
  }
  return undefined;
}

function targetFromArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const preferredKeys = toolName === "bash"
    ? ["command"]
    : toolName.startsWith("remote_")
      ? ["device", "query", "host", "command", "path"]
      : toolName.startsWith("tavily_")
        ? ["query", "input", "url", "urls"]
        : ["path", "query", "command", "device", "url", "urls", "input", "issue", "pr", "name", "id"];
  for (const key of preferredKeys) {
    const value = compactValue(record[key]);
    if (!value) continue;
    const firstLine = value.split("\n")[0];
    if (key === "path") {
      const skillMatch = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/.exec(firstLine);
      if (skillMatch) return `skill ${skillMatch[1]} · ${firstLine}`;
    }
    return firstLine;
  }
  for (const [key, value] of Object.entries(record)) {
    if (/^(allowDangerous|sudo|timeout|timeout_seconds|max_output_bytes|total_max_output_bytes)$/i.test(key)) continue;
    const compact = compactValue(value);
    if (compact) return `${key}=${compact}`;
  }
  return undefined;
}

function resultText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text"
      ? textOf((item as { text?: unknown }).text)
      : undefined)
    .filter((item): item is string => Boolean(item))
    .join(" ");
  return text || undefined;
}

function detailFromResult(result: unknown, isError = false): string | undefined {
  const text = resultText(result);
  if (text) return truncate(text, MAX_DETAIL_SUMMARY_LENGTH);
  if (!result || typeof result !== "object") return isError ? "tool failed" : undefined;
  const details = (result as { details?: unknown }).details;
  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;
    for (const key of ["summary", "message", "status", "error", "path", "url", "count"]) {
      const value = compactValue(record[key]);
      if (value) return truncate(`${key === "summary" || key === "message" ? "" : `${key}=`}${value}`, MAX_DETAIL_SUMMARY_LENGTH);
    }
  }
  return isError ? "tool failed" : "completed";
}

function formatTool(tool: ToolSnapshot | undefined): string {
  if (!tool) return "idle";
  const icon = tool.status === "running" ? "run" : tool.status === "success" ? "ok" : "err";
  const target = tool.target ? ` ${truncate(tool.target)}` : "";
  const detail = tool.detail ? ` · ${truncate(tool.detail, MAX_DETAIL_SUMMARY_LENGTH)}` : "";
  return `${icon} ${tool.name}${target}${detail}`;
}

function stepText(): string {
  const now = Date.now();
  if (state.explicitStep && (!state.explicitStep.expiresAt || state.explicitStep.expiresAt > now)) {
    return truncate(state.explicitStep.text, MAX_STEP_LENGTH);
  }
  if (state.currentTool) return `tool ${state.currentTool.name}`;
  if (state.timer?.enabled && state.timer.stage !== "idle") return state.timer.stage;
  return "ready";
}

function timerText(): string {
  if (!state.timer?.enabled) return "off";
  return `${state.timer.elapsed} ${truncate(state.timer.stage, 18)}`;
}

function stepFooterText(): string {
  const step = stepText();
  if (!state.timer?.enabled || state.timer.stage === "idle" || !state.timer.elapsed) return step;
  return `${step} · ${state.timer.elapsed}`;
}

function displayCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length) || "/"}`;
  return cwd;
}

function contextUsageText(ctx: ExtensionContext): string | undefined {
  const usage = ctx.getContextUsage?.();
  if (!usage) return undefined;
  const window = formatCount(usage.contextWindow);
  if (usage.percent === null) return `-/${window}`;
  return `${usage.percent.toFixed(0)}%/${window}`;
}

function refreshFooterContext(ctx: ExtensionContext | undefined): void {
  if (!ctx) return;
  const modelId = textOf(ctx.model?.id);
  const modelName = textOf(ctx.model?.name);
  const provider = textOf(ctx.model?.provider);
  if (modelId) state.cachedContext.modelId = modelId;
  if (modelName) state.cachedContext.modelName = modelName;
  if (provider) state.cachedContext.provider = provider;
  const cwd = textOf(ctx.cwd);
  if (cwd) state.cachedContext.cwd = displayCwd(cwd);
  const usage = contextUsageText(ctx);
  if (usage) state.cachedContext.contextUsage = usage;
}

function modelText(_ctx: ExtensionContext | undefined): string {
  return state.cachedContext.modelName ?? state.cachedContext.modelId ?? "pending";
}

function cwdText(ctx: ExtensionContext | undefined): string {
  if (state.cachedContext.cwd) return state.cachedContext.cwd;
  const cwd = textOf(ctx?.cwd) ?? process.cwd();
  return cwd ? displayCwd(cwd) : "-";
}

function contextText(_ctx: ExtensionContext | undefined): string {
  return state.cachedContext.contextUsage ?? "-";
}

function tokenText(ctx: ExtensionContext | undefined): string {
  if (!ctx) return state.cachedContext.tokens ?? "0";
  const branch = ctx.sessionManager.getBranch() ?? [];
  const sessionId = ctx?.sessionManager.getSessionId() ?? "none";
  const cacheKey = `${sessionId}:${branch.length}`;
  if (state.tokenTextCache?.key === cacheKey) return state.tokenTextCache.text;

  let input = 0;
  let output = 0;
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const usage = (entry.message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }).usage;
    input += usage?.input ?? 0;
    input += usage?.cacheRead ?? 0;
    input += usage?.cacheWrite ?? 0;
    output += usage?.output ?? 0;
  }

  const text = !input && !output ? "0" : `in ${formatCount(input)} out ${formatCount(output)}`;
  state.tokenTextCache = { key: cacheKey, text };
  state.cachedContext.tokens = text;
  return text;
}

function color(theme: FooterTheme, hex: string, fallback: string, text: string): string {
  return theme.rgb?.(hex, text) ?? theme.fg?.(fallback, text) ?? text;
}

function label(theme: FooterTheme, text: string): string {
  return color(theme, LABEL_COLOR, "accent", text);
}

function value(theme: FooterTheme, text: string, tone: "normal" | "dim" | "warn" | "error" = "normal"): string {
  if (tone === "dim") return color(theme, DIM_COLOR, "dim", text);
  if (tone === "warn") return color(theme, WARN_COLOR, "warning", text);
  if (tone === "error") return color(theme, ERROR_COLOR, "error", text);
  return color(theme, VALUE_COLOR, "success", text);
}

function segment(theme: FooterTheme, name: string, text: string, tone?: "normal" | "dim" | "warn" | "error"): string {
  return `${label(theme, name)} ${value(theme, text, tone)}`;
}

function frameParts(theme: FooterTheme): { left: string; right: string } {
  return {
    left: color(theme, BORDER_COLOR, "accent", "┃ "),
    right: color(theme, BORDER_COLOR, "accent", " ┃"),
  };
}

function frameLine(theme: FooterTheme, body: string, width: number): string {
  const { left, right } = frameParts(theme);
  const innerWidth = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
  const clipped = truncateToWidth(body, innerWidth, value(theme, "...", "dim"));
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
  return left + clipped + padding + right;
}

function alignedColumn(
  theme: FooterTheme,
  width: number,
  name: string,
  text: string,
  tone: "normal" | "dim" | "warn" | "error" = "normal",
): string {
  const safeWidth = Math.max(0, width);
  const labelWidth = Math.min(FOOTER_LABEL_WIDTH, safeWidth);
  const rawLabel = truncateToWidth(name, labelWidth, "").padEnd(labelWidth, " ");
  const valueWidth = Math.max(0, safeWidth - labelWidth - (safeWidth > labelWidth ? 1 : 0));
  const rawValue = truncateToWidth(sanitizeInline(text), valueWidth, valueWidth > 0 ? "…" : "");
  const separator = valueWidth > 0 ? " " : "";
  const body = label(theme, rawLabel) + separator + value(theme, rawValue, tone);
  return body + " ".repeat(Math.max(0, safeWidth - visibleWidth(body)));
}

function naturalColumnWidth(text: string): number {
  return FOOTER_LABEL_WIDTH + 1 + visibleWidth(sanitizeInline(text));
}

function flowColumn(
  theme: FooterTheme,
  width: number,
  name: string,
  text: string,
  tone: "normal" | "dim" | "warn" | "error" = "normal",
): string {
  return alignedColumn(theme, width, name, text, tone).trimEnd();
}

function alignedRow(
  theme: FooterTheme,
  width: number,
  left: { name: string; text: string; tone?: "normal" | "dim" | "warn" | "error" },
  right: { name: string; text: string; tone?: "normal" | "dim" | "warn" | "error" },
): string {
  const { left: frameLeft, right: frameRight } = frameParts(theme);
  const innerWidth = Math.max(0, width - visibleWidth(frameLeft) - visibleWidth(frameRight));
  const gap = Math.min(FOOTER_COLUMN_GAP, innerWidth);
  const available = Math.max(0, innerWidth - gap);
  const minimumRightWidth = Math.min(FOOTER_LABEL_WIDTH + 2, Math.floor(available / 2));
  const leftWidth = Math.min(naturalColumnWidth(left.text), Math.max(0, available - minimumRightWidth));
  const rightWidth = Math.max(0, available - leftWidth);
  const body = flowColumn(theme, leftWidth, left.name, left.text, left.tone)
    + " ".repeat(gap)
    + flowColumn(theme, rightWidth, right.name, right.text, right.tone);
  return frameLine(theme, body, width);
}

function alignedFullRow(
  theme: FooterTheme,
  width: number,
  name: string,
  text: string,
  tone: "normal" | "dim" | "warn" | "error" = "normal",
): string {
  const { left, right } = frameParts(theme);
  const innerWidth = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
  return frameLine(theme, alignedColumn(theme, innerWidth, name, text, tone), width);
}

function detailTone(value: unknown): DetailLaneTone {
  return value === "dim" || value === "warn" || value === "error" || value === "normal" ? value : "dim";
}

function detailLaneText(): string {
  return state.detailLane?.summary ? truncate(state.detailLane.summary, MAX_DETAIL_SUMMARY_LENGTH) : "idle";
}

function detailLaneInfo(): string {
  return state.detailLane?.info ? truncate(state.detailLane.info, MAX_DETAIL_SUMMARY_LENGTH) : "-";
}

function aggregatedDetailText(): string {
  const detail = detailLaneText();
  const info = detailLaneInfo();
  const hasPublishedDetail = detail !== "idle" || info !== "-";
  const showLatestAlongsideDetail = state.detailLane?.source === "skill" || state.detailLane?.source === "prompt";
  const tool = state.currentTool
    ? formatTool(state.currentTool)
    : state.latestTool && (!hasPublishedDetail || showLatestAlongsideDetail)
      ? `last ${formatTool(state.latestTool)}`
      : undefined;
  const parts = [tool, detail !== "idle" ? detail : undefined, info !== "-" ? info : undefined]
    .filter((part): part is string => Boolean(part));
  const unique: string[] = [];
  for (const part of parts) {
    if (unique[unique.length - 1] !== part) unique.push(part);
  }
  return unique.length > 0 ? unique.join(" · ") : "idle";
}

function aggregatedDetailTone(): DetailLaneTone {
  const hasPublishedDetail = detailLaneText() !== "idle" || detailLaneInfo() !== "-";
  if (state.currentTool?.status === "error" || (!hasPublishedDetail && state.latestTool?.status === "error")) return "error";
  return hasPublishedDetail ? state.detailLane?.tone ?? "dim" : state.currentTool ? "normal" : "dim";
}

function detailLaneLines(): string[] {
  if (!state.detailLane?.expanded) return [];
  return state.detailLane.lines.slice(0, MAX_DETAIL_LINES).map((line) => truncate(line, MAX_DETAIL_SUMMARY_LENGTH));
}

function setDetailLane(payload: DetailLaneEvent): void {
  const source = textOf(payload.source) ?? "detail";
  const summary = textOf(payload.summary);
  if (!summary) return;
  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  state.detailLane = {
    source,
    summary,
    info: textOf(payload.info) ?? "-",
    lines: rawLines.map(textOf).filter((line): line is string => Boolean(line)).slice(0, MAX_DETAIL_LINES),
    expanded: payload.expanded === true,
    tone: detailTone(payload.tone),
  };
  publish();
}

function footerLines(theme: FooterTheme, width: number): string[] {
  const ctx = state.lastContext;
  refreshFooterContext(ctx);
  const lines = [
    alignedRow(theme, width,
      { name: "MODEL", text: modelText(ctx) },
      { name: "CWD", text: cwdText(ctx), tone: "dim" }),
    alignedRow(theme, width,
      { name: "CTX", text: contextText(ctx) },
      { name: "STEP", text: stepFooterText() }),
    alignedFullRow(theme, width, "DETAIL", aggregatedDetailText(), aggregatedDetailTone()),
  ];
  for (const detail of detailLaneLines()) lines.push(frameLine(theme, value(theme, detail, state.detailLane?.tone ?? "dim"), width));
  return lines;
}

function installFooter(ctx: StatusPublisherContext): void {
  if (!ctx.hasUI || state.footerInstalled) return;
  ctx.ui.setFooter((tui, theme, footerData) => {
    state.requestRender = () => tui.requestRender();
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    return {
      dispose() {
        unsubscribe();
        if (state.requestRender) state.requestRender = undefined;
      },
      invalidate() {},
      render(width: number): string[] {
        return footerLines(theme, width);
      },
    };
  });
  state.footerInstalled = true;
}

function uninstallFooter(ctx: StatusPublisherContext): void {
  if (!ctx.hasUI || !state.footerInstalled) return;
  ctx.ui.setFooter(undefined);
  state.footerInstalled = false;
  state.requestRender = undefined;
}

function publish(ctx: StatusPublisherContext | undefined = state.lastContext): void {
  refreshFooterContext(ctx as ExtensionContext | undefined);
  if (!ctx?.hasUI) return;
  if (state.enabled) installFooter(ctx);
  else uninstallFooter(ctx);
  state.requestRender?.();
}

function reset(ctx?: ExtensionContext): void {
  state.currentTool = undefined;
  state.latestTool = undefined;
  state.detailLane = undefined;
  state.toolCount = 0;
  state.explicitStep = undefined;
  if (stepTimer) clearTimeout(stepTimer);
  stepTimer = undefined;
  publish(ctx);
}

function setStep(payload: StepEvent): void {
  const text = textOf(payload.text);
  if (!text) return;
  if (stepTimer) clearTimeout(stepTimer);
  const ttlMs = typeof payload.ttlMs === "number" && payload.ttlMs > 0 ? payload.ttlMs : DEFAULT_STEP_TTL_MS;
  state.explicitStep = { text, expiresAt: Date.now() + ttlMs };
  stepTimer = setTimeout(() => {
    state.explicitStep = undefined;
    stepTimer = undefined;
    publish();
  }, ttlMs);
  (stepTimer as { unref?: () => void }).unref?.();
  publish();
}

function workflowCardKind(value: unknown): WorkflowCardKind {
  return value === "success" || value === "warning" || value === "error" || value === "info" ? value : "info";
}

function workflowCardMeta(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(textOf).filter((item): item is string => Boolean(item)).slice(0, MAX_CARD_META_ITEMS);
}

function workflowCardTone(kind: WorkflowCardKind): "normal" | "warn" | "error" {
  if (kind === "warning") return "warn";
  if (kind === "error") return "error";
  return "normal";
}

function workflowCardColor(theme: FooterTheme, kind: WorkflowCardKind, text: string): string {
  if (kind === "success") return color(theme, SUCCESS_COLOR, "success", text);
  if (kind === "warning") return color(theme, WARN_COLOR, "warning", text);
  if (kind === "error") return color(theme, ERROR_COLOR, "error", text);
  return color(theme, INFO_COLOR, "accent", text);
}

function renderWorkflowCard(theme: FooterTheme, width: number, card: WorkflowCardSnapshot): string {
  const labelText = workflowCardColor(theme, card.kind, `CARD ${card.kind}`);
  const pieces = [
    labelText,
    value(theme, truncate(card.title, MAX_CARD_TITLE_LENGTH), workflowCardTone(card.kind)),
  ];
  if (card.detail) pieces.push(value(theme, truncate(card.detail, MAX_CARD_DETAIL_LENGTH), "dim"));
  if (card.meta.length > 0) pieces.push(value(theme, card.meta.map((item) => truncate(item, 24)).join("  "), "dim"));
  return frameLine(theme, pieces.join(value(theme, "  |  ", "dim")), width);
}

function clearWorkflowCard(ctx: StatusPublisherContext | undefined = state.lastContext): void {
  if (cardTimer) clearTimeout(cardTimer);
  cardTimer = undefined;
  state.workflowCard = undefined;
  if (ctx?.hasUI) ctx.ui.setWidget(WORKFLOW_CARD_WIDGET_KEY, undefined, { placement: "belowEditor" });
}

function publishWorkflowCard(ctx: StatusPublisherContext | undefined = state.lastContext): void {
  if (!ctx?.hasUI || !state.workflowCard) return;
  const width = Math.max(40, process.stdout.columns || 100);
  ctx.ui.setWidget(WORKFLOW_CARD_WIDGET_KEY, renderWorkflowCard(ctx.ui.theme, width, state.workflowCard), { placement: "belowEditor" });
}

function setWorkflowCard(payload: WorkflowCardEvent, ctx: StatusPublisherContext | undefined = state.lastContext): void {
  const title = textOf(payload.title);
  if (!title) return;
  if (cardTimer) clearTimeout(cardTimer);
  const ttlMs = typeof payload.ttlMs === "number" && payload.ttlMs > 0 ? payload.ttlMs : DEFAULT_CARD_TTL_MS;
  state.workflowCard = {
    kind: workflowCardKind(payload.kind),
    title,
    detail: textOf(payload.detail),
    meta: workflowCardMeta(payload.meta),
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };
  publishWorkflowCard(ctx);
  cardTimer = setTimeout(() => clearWorkflowCard(), ttlMs);
  (cardTimer as { unref?: () => void }).unref?.();
}

function ttlMsFromMeta(value: string): number | undefined {
  const match = /^ttl(?:\s+|=)?(\d+(?:\.\d+)?)(ms|s|sec|secs|m|min|mins)?$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = (match[2] ?? "ms").toLowerCase();
  if (unit === "m" || unit === "min" || unit === "mins") return Math.round(amount * 60_000);
  if (unit === "s" || unit === "sec" || unit === "secs") return Math.round(amount * 1000);
  return Math.round(amount);
}

function parseWorkflowCardCommand(args: unknown): WorkflowCardEvent | "clear" | undefined {
  const raw = typeof args === "string" ? sanitizeInline(args) : "";
  if (!raw || raw === "status") return undefined;
  if (raw === "clear" || raw === "hide") return "clear";
  if (raw === "demo") return { kind: "success", title: "Verification passed", detail: "workflow card demo", meta: ["demo"], ttlMs: 6000 };
  const [head = "", detail, ...meta] = raw.split("|").map((part) => sanitizeInline(part));
  const [maybeKind, ...titleParts] = head.split(/\s+/);
  const kind = workflowCardKind(maybeKind);
  const title = kind === maybeKind ? titleParts.join(" ") : head;
  const visibleMeta: string[] = [];
  let ttlMs: number | undefined;
  for (const item of meta.filter(Boolean)) {
    const parsedTtlMs = ttlMsFromMeta(item);
    if (parsedTtlMs && ttlMs === undefined) ttlMs = parsedTtlMs;
    else visibleMeta.push(item);
  }
  return { kind, title: title || head, detail, meta: visibleMeta, ttlMs };
}

export function updateTaskTimerFooter(snapshot: TimerSnapshot, ctx?: StatusPublisherContext): void {
  state.timer = {
    enabled: snapshot.enabled,
    elapsed: sanitizeInline(snapshot.elapsed),
    stage: sanitizeInline(snapshot.stage),
  };
  publish(ctx);
}

export function clearTaskTimerFooter(ctx?: StatusPublisherContext): void {
  state.timer = undefined;
  publish(ctx);
}

export function showOhMyPiStatusBar(ctx: ExtensionCommandContext): void {
  refreshFooterContext(ctx);
  if (!ctx.hasUI) return;
  const fullModel = state.cachedContext.modelId
    ? `${state.cachedContext.provider ? `${state.cachedContext.provider}/` : ""}${state.cachedContext.modelId}`
    : "pending";
  const modelDisplay = state.cachedContext.modelName ?? state.cachedContext.modelId ?? "pending";
  const lines = [
    `Status: ${state.enabled ? "enabled" : "disabled"}`,
    `Footer: ${state.footerInstalled ? "installed" : "not installed"}`,
    `Model: ${modelDisplay} (${fullModel})`,
    `Tokens: ${tokenText(ctx)}`,
    `Step: ${stepText()}`,
    `Current tool: ${formatTool(state.currentTool)}`,
    `Latest tool: ${formatTool(state.latestTool)}`,
    `Timer: ${timerText()}`,
    `Workflow card: ${state.workflowCard ? `${state.workflowCard.kind} ${state.workflowCard.title}` : "none"}`,
    `Detail: ${detailLaneText()} | Info: ${detailLaneInfo()}${state.detailLane?.expanded ? " (expanded)" : ""}`,
    `Tool calls this turn: ${state.toolCount}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export default function ohMyPiStatusBar(pi: ExtensionAPI): void {
  pi.registerCommand("workflow-card", {
    description: "Show a UI-only oh-my-pi workflow milestone card",
    handler: async (args, ctx) => {
      state.lastContext = ctx;
      const parsed = parseWorkflowCardCommand(args);
      if (parsed === "clear") {
        clearWorkflowCard(ctx);
        if (ctx.hasUI) ctx.ui.notify("Workflow card cleared", "info");
        return;
      }
      if (!parsed) {
        showOhMyPiStatusBar(ctx);
        return;
      }
      setWorkflowCard(parsed, ctx);
    },
  });

  pi.registerCommand("status-bar", {
    description: "Show or toggle the oh-my-pi owned footer and tool activity summary",
    handler: async (args, ctx) => {
      state.lastContext = ctx;
      const action = String(args ?? "").trim().toLowerCase();
      if (action === "off") state.enabled = false;
      else if (action === "on") state.enabled = true;
      else if (action === "toggle") state.enabled = !state.enabled;
      else if (action && action !== "status") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /status-bar [status|on|off|toggle]", "warning");
        return;
      }
      publish(ctx);
      showOhMyPiStatusBar(ctx);
    },
  });

  pi.events.on("oh-my-pi:step", (payload) => setStep((payload ?? {}) as StepEvent));
  pi.events.on("oh-my-pi:card", (payload) => setWorkflowCard((payload ?? {}) as WorkflowCardEvent));
  pi.events.on("oh-my-pi:detail", (payload) => setDetailLane((payload ?? {}) as DetailLaneEvent));

  pi.on("session_start", (_event, ctx) => {
    state.cachedContext = {};
    state.lastContext = ctx;
    reset(ctx);
    publish(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (stepTimer) clearTimeout(stepTimer);
    stepTimer = undefined;
    clearWorkflowCard(ctx);
    uninstallFooter(ctx);
    state.currentTool = undefined;
    state.latestTool = undefined;
    state.timer = undefined;
    state.explicitStep = undefined;
    state.workflowCard = undefined;
    state.detailLane = undefined;
    state.cachedContext = {};
    state.toolCount = 0;
    state.lastContext = undefined;
  });

  pi.on("input", (event, ctx) => {
    state.lastContext = ctx;
    reset(ctx);
    const raw = String((event as { text?: unknown }).text ?? "").trim();
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(raw);
    if (!match) return;
    const command = pi.getCommands().find((item) => item.name === match[1]);
    if (!command || (command.source !== "skill" && command.source !== "prompt")) return;
    const source = command.source === "skill" ? "skill" : "prompt";
    state.detailLane = {
      source,
      summary: `${source} /${command.name}${command.description ? ` · ${command.description}` : ""}`,
      info: sanitizeInline(match[2] ?? "") || command.sourceInfo?.path || "-",
      lines: [],
      expanded: false,
      tone: "normal",
    };
    publish(ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    state.lastContext = ctx;
    const toolName = String((event as { toolName?: unknown }).toolName ?? "tool");
    const snapshot: ToolSnapshot = {
      id: String((event as { toolCallId?: unknown }).toolCallId ?? `${Date.now()}`),
      name: toolName,
      target: targetFromArgs(toolName, (event as { args?: unknown }).args),
      status: "running",
      startedAt: Date.now(),
    };
    state.currentTool = snapshot;
    state.latestTool = snapshot;
    state.toolCount += 1;
    publish(ctx);
  });

  pi.on("tool_execution_update", (event, ctx) => {
    state.lastContext = ctx;
    const id = String((event as { toolCallId?: unknown }).toolCallId ?? "");
    if (!state.currentTool || (id && state.currentTool.id !== id)) return;
    const detail = detailFromResult((event as { partialResult?: unknown }).partialResult);
    if (detail) state.currentTool.detail = detail;
    publish(ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    state.lastContext = ctx;
    const id = String((event as { toolCallId?: unknown }).toolCallId ?? "");
    const isCurrent = state.currentTool && (!id || state.currentTool.id === id);
    const finished = isCurrent ? state.currentTool : state.latestTool;
    if (finished) {
      const isError = (event as { isError?: boolean }).isError === true;
      finished.status = isError ? "error" : "success";
      finished.detail = detailFromResult((event as { result?: unknown }).result, isError) ?? finished.detail;
      finished.endedAt = Date.now();
      state.latestTool = finished;
    }
    if (isCurrent) state.currentTool = undefined;
    publish(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    state.lastContext = ctx;
    state.currentTool = undefined;
    publish(ctx);
  });
}
