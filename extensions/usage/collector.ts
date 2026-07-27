import { eventIdentity } from "./identity.ts";
import type { UsageEvent } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function text(...values: unknown[]): string {
  return values.find((value) => typeof value === "string") as string | undefined ?? "";
}

export function collectUsageEvent(record: UnknownRecord, rawRecord: string, projectPath: string): UsageEvent | undefined {
  const type = record.type;
  let operation: UsageEvent["operation"] | undefined;
  let owner = record;

  if (type === "message") {
    const message = object(record.message);
    const role = message?.role;
    if (role === "assistant") operation = "assistant";
    else if (role === "toolResult") operation = "toolResult";
    else return undefined;
    owner = message ?? record;
  } else if (type === "compaction" || type === "branch_summary") {
    operation = type;
  } else {
    return undefined;
  }

  const usage = object(owner.usage) ?? object(record.usage);
  if (!usage) return undefined;
  const cost = object(usage.cost);
  const timestamp = text(record.timestamp, owner.timestamp);
  const timestampMs = Date.parse(timestamp);
  if (!timestamp || Number.isNaN(timestampMs)) return undefined;

  return {
    identity: eventIdentity(record, rawRecord),
    timestamp: new Date(timestampMs).toISOString(),
    operation,
    provider: text(owner.provider, record.provider),
    model: text(owner.model, record.model),
    projectPath,
    input: number(usage.input),
    output: number(usage.output),
    cacheRead: number(usage.cacheRead),
    cacheWrite: number(usage.cacheWrite),
    cost: number(cost?.total),
    responses: operation === "assistant" ? 1 : 0,
  };
}
