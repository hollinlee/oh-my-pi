import type { UsageStore } from "./store.ts";
import type { UsageTotals } from "./types.ts";

export type UsageRange = "today" | "7d" | "30d";
export type BreakdownKind = "models" | "providers" | "projects";

export type UsageBucket = {
  from: string;
  to: string;
  label: string;
  total: number;
};

export type UsageBreakdown = {
  label: string;
  total: number;
};

export type UsageDashboardSnapshot = {
  range: UsageRange;
  from: string;
  to: string;
  generatedAt: string;
  totals: UsageTotals;
  buckets: UsageBucket[];
  breakdowns: Record<BreakdownKind, UsageBreakdown[]>;
};

export type TimeBucket = { from: Date; to: Date; label: string };
export type UsageTimeRange = { from: Date; to: Date; buckets: TimeBucket[] };

function localHourLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).replace(" ", "").toLowerCase();
}

function localDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function usageTimeRange(range: UsageRange, now = new Date()): UsageTimeRange {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);

  if (range === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const buckets: TimeBucket[] = [];
    for (let cursor = from.getTime(); cursor < end.getTime(); cursor += 60 * 60 * 1000) {
      const bucketFrom = new Date(cursor);
      const bucketTo = new Date(Math.min(cursor + 60 * 60 * 1000, end.getTime()));
      buckets.push({ from: bucketFrom, to: bucketTo, label: localHourLabel(bucketFrom) });
    }
    return { from, to: end, buckets };
  }

  const days = range === "7d" ? 7 : 30;
  const from = new Date(end);
  from.setDate(from.getDate() - days);
  const buckets: TimeBucket[] = [];
  let cursor = new Date(from);
  while (cursor < end) {
    const bucketTo = new Date(cursor);
    bucketTo.setDate(bucketTo.getDate() + 1);
    buckets.push({ from: new Date(cursor), to: bucketTo, label: localDayLabel(cursor) });
    cursor = bucketTo;
  }
  return { from, to: end, buckets };
}

export function eventTotal(value: Pick<UsageTotals, "input" | "output" | "cacheRead" | "cacheWrite">): number {
  return value.input + value.output + value.cacheRead + value.cacheWrite;
}


export function queryUsageDashboard(store: UsageStore, range: UsageRange, now = new Date()): UsageDashboardSnapshot {
  const time = usageTimeRange(range, now);
  const totals = store.totals(time.from, time.to);
  const totalStatement = store.db.prepare(`
    SELECT COALESCE(SUM(input + output + cache_read + cache_write), 0) AS total
    FROM events WHERE timestamp >= ? AND timestamp < ?
  `);
  const buckets = time.buckets.map((bucket) => ({
    from: bucket.from.toISOString(),
    to: bucket.to.toISOString(),
    label: bucket.label,
    total: (totalStatement.get(bucket.from.toISOString(), bucket.to.toISOString()) as { total: number }).total,
  }));

  const breakdownExpressions: Record<BreakdownKind, string> = {
    models: "CASE WHEN model = '' THEN 'Tools/summaries' ELSE provider || '/' || model END",
    providers: "CASE WHEN provider = '' THEN 'Tools/summaries' ELSE provider END",
    projects: "CASE WHEN project_path = '' THEN 'Unknown project' ELSE project_path END",
  };
  const breakdowns = {} as Record<BreakdownKind, UsageBreakdown[]>;
  for (const kind of Object.keys(breakdownExpressions) as BreakdownKind[]) {
    const expression = breakdownExpressions[kind];
    breakdowns[kind] = store.db.prepare(`
      SELECT ${expression} AS label, SUM(input + output + cache_read + cache_write) AS total
      FROM events WHERE timestamp >= ? AND timestamp < ?
      GROUP BY ${expression}
      ORDER BY total DESC, label ASC
    `).all(time.from.toISOString(), time.to.toISOString()) as UsageBreakdown[];
  }

  return {
    range,
    from: time.from.toISOString(),
    to: time.to.toISOString(),
    generatedAt: now.toISOString(),
    totals,
    buckets,
    breakdowns,
  };
}
