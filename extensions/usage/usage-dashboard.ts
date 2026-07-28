import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { BreakdownKind, UsageDashboardSnapshot, UsageRange } from "./dashboard-data.ts";
import { eventTotal } from "./dashboard-data.ts";
import type { LoadUsageDashboardOptions, LoadUsageDashboardResult } from "./dashboard-loader.ts";
import { loadUsageDashboard } from "./dashboard-loader.ts";

export type UsageDashboardLoader = (options: LoadUsageDashboardOptions) => Promise<LoadUsageDashboardResult>;

type DashboardState = "loading" | "ready" | "error";
const ranges: UsageRange[] = ["today", "7d", "30d"];
const breakdownKinds: BreakdownKind[] = ["models", "providers", "projects"];

function compact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function money(value: number): string {
  return value < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function percent(numerator: number, denominator: number): string {
  return denominator === 0 ? "0.0%" : `${(numerator / denominator * 100).toFixed(1)}%`;
}

function plainBar(value: number, max: number, width: number): string {
  const filled = max === 0 ? 0 : Math.max(1, Math.round(value / max * width));
  return "#".repeat(filled).padEnd(width, ".");
}

function verticalChart(values: number[], width: number, height: number): string[] {
  if (values.length === 0) return ["No usage in this range"];
  const columnCount = Math.max(1, Math.min(values.length, width));
  const groupSize = Math.ceil(values.length / columnCount);
  const columns: number[] = [];
  for (let index = 0; index < values.length; index += groupSize) {
    columns.push(values.slice(index, index + groupSize).reduce((sum, value) => sum + value, 0));
  }
  const max = Math.max(0, ...columns);
  if (max === 0) return ["No usage in this range"];
  const rows = [`max ${compact(max)}`];
  for (let level = height; level >= 1; level--) {
    rows.push(columns.map((value) => max > 0 && Math.ceil(value / max * height) >= level ? "#" : " ").join(""));
  }
  return rows;
}

export class UsageDashboard implements Component {
  private state: DashboardState = "loading";
  private range: UsageRange = "today";
  private breakdown: BreakdownKind = "models";
  private snapshot?: UsageDashboardSnapshot;
  private intakeErrors = 0;
  private error?: string;
  private request?: AbortController;
  private disposed = false;
  private readonly tui: Pick<TUI, "requestRender">;
  private readonly theme: Theme;
  private readonly done: () => void;
  private readonly paths: Pick<LoadUsageDashboardOptions, "stateDir" | "sessionsDir" | "intakePath">;
  private readonly loader: UsageDashboardLoader;

  constructor(
    tui: Pick<TUI, "requestRender">,
    theme: Theme,
    done: () => void,
    paths: Pick<LoadUsageDashboardOptions, "stateDir" | "sessionsDir" | "intakePath">,
    loader: UsageDashboardLoader = loadUsageDashboard,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.paths = paths;
    this.loader = loader;
    this.refresh();
  }

  get selectedRange(): UsageRange { return this.range; }
  get selectedBreakdown(): BreakdownKind { return this.breakdown; }
  get status(): DashboardState { return this.state; }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.dispose();
      this.done();
      return;
    }
    const rangeIndex = ["1", "2", "3"].findIndex((key) => matchesKey(data, key as "1" | "2" | "3"));
    if (rangeIndex >= 0 && this.range !== ranges[rangeIndex]) {
      this.range = ranges[rangeIndex]!;
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.breakdown = breakdownKinds[(breakdownKinds.indexOf(this.breakdown) + 1) % breakdownKinds.length]!;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "r")) this.refresh();
  }

  refresh(): void {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.state = "loading";
    this.error = undefined;
    this.tui.requestRender();
    void this.loader({ ...this.paths, range: this.range, signal: request.signal, sync: true }).then(
      ({ snapshot, intakeErrors }) => {
        if (this.disposed || this.request !== request) return;
        this.snapshot = snapshot;
        this.intakeErrors = intakeErrors;
        this.state = "ready";
        this.tui.requestRender();
      },
      (error: unknown) => {
        if (this.disposed || this.request !== request || request.signal.aborted) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.state = "error";
        this.tui.requestRender();
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.request?.abort();
  }

  invalidate(): void {
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const lines = this.renderContent(safeWidth);
    return lines.map((line) => visibleWidth(line) > safeWidth ? truncateToWidth(line, safeWidth, "") : line);
  }

  private renderContent(width: number): string[] {
    const t = this.theme;
    const selected = (active: boolean, text: string): string => active ? t.fg("accent", t.bold(`[${text}]`)) : t.fg("muted", ` ${text} `);
    const lines = [
      t.fg("accent", t.bold("Usage Dashboard")),
      `${selected(this.range === "today", "1 Today")}  ${selected(this.range === "7d", "2 7 days")}  ${selected(this.range === "30d", "3 30 days")}`,
      t.fg("dim", "Tab breakdown  r refresh  Esc close"),
      "",
    ];

    if (this.state === "loading") {
      lines.push(t.fg("muted", `Loading ${this.range === "today" ? "today" : this.range} usage...`));
      return lines;
    }
    if (this.state === "error" || !this.snapshot) {
      lines.push(t.fg("error", "Unable to load usage"), truncateToWidth(this.error ?? "Unknown error", width, "..."));
      return lines;
    }

    const snapshot = this.snapshot;
    const total = eventTotal(snapshot.totals);
    lines.push(
      t.bold("Summary"),
      `Total ${compact(total)}   Input ${compact(snapshot.totals.input)}   Output ${compact(snapshot.totals.output)}`,
      `Cache read ${compact(snapshot.totals.cacheRead)}   Cache write ${compact(snapshot.totals.cacheWrite)}   Hit ${percent(snapshot.totals.cacheRead, snapshot.totals.input + snapshot.totals.cacheRead)}`,
      `Cost ${money(snapshot.totals.cost)}   Responses ${snapshot.totals.responses}`,
    );
    if (this.intakeErrors > 0) lines.push(t.fg("warning", `Skipped ${this.intakeErrors} invalid intake record(s)`));
    lines.push("", t.bold("Total by time"));

    const chartWidth = Math.max(1, width - 2);
    const chart = verticalChart(snapshot.buckets.map((bucket) => bucket.total), chartWidth, 4);
    lines.push(...chart.map((line) => t.fg(line.startsWith("max ") ? "dim" : "accent", line)));
    if (snapshot.buckets.length > 0) {
      const first = snapshot.buckets[0]!.label;
      const last = snapshot.buckets.at(-1)!.label;
      const gap = Math.max(1, chartWidth - visibleWidth(first) - visibleWidth(last));
      lines.push(t.fg("dim", truncateToWidth(`${first}${" ".repeat(gap)}${last}`, chartWidth, "")));
    }

    const title = this.breakdown[0]!.toUpperCase() + this.breakdown.slice(1);
    lines.push("", t.bold(`${title} breakdown`));
    const entries = snapshot.breakdowns[this.breakdown].slice(0, 5);
    const breakdownMax = Math.max(0, ...entries.map((entry) => entry.total));
    if (entries.length === 0) lines.push(t.fg("muted", "No usage to break down"));
    else {
      const labelWidth = Math.max(12, Math.min(30, Math.floor(width * 0.42)));
      const barWidth = Math.max(4, Math.min(16, width - labelWidth - 12));
      for (const entry of entries) {
        const label = truncateToWidth(entry.label, labelWidth, "...").padEnd(labelWidth, " ");
        lines.push(`${label} ${t.fg("success", plainBar(entry.total, breakdownMax, barWidth))} ${compact(entry.total)}`);
      }
    }
    return lines;
  }
}
