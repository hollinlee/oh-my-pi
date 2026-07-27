import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { usageStateDir } from "./paths.ts";
import type { UsageStore } from "./store.ts";
import type { UsageEvent } from "./types.ts";

export const USAGE_INTAKE_VERSION = "usage-event-v1" as const;

export type UsageIntakeEvent = {
  version: typeof USAGE_INTAKE_VERSION;
  event_uid: string;
  timestamp: string;
  operation: UsageEvent["operation"];
  provider: string;
  model: string;
  projectPath: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  responses: number;
};

export type UsageIntakeInput = Omit<UsageIntakeEvent, "version" | "event_uid"> & { eventUid?: string };
export type UsageIntakeError = { line: number; error: string };
export type UsageIntakeResult = { added: number; errors: UsageIntakeError[] };

export function usageIntakePath(stateDir = usageStateDir()): string {
  return join(stateDir, "intake", `${USAGE_INTAKE_VERSION}.jsonl`);
}

export function writeUsageIntake(input: UsageIntakeInput, stateDir = usageStateDir()): UsageIntakeEvent {
  const event: UsageIntakeEvent = {
    version: USAGE_INTAKE_VERSION,
    event_uid: input.eventUid || randomUUID(),
    timestamp: input.timestamp,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    projectPath: input.projectPath,
    input: input.input,
    output: input.output,
    cacheRead: input.cacheRead,
    cacheWrite: input.cacheWrite,
    cost: input.cost,
    responses: input.responses,
  };
  parseEvent(event);
  const path = usageIntakePath(stateDir);
  const dir = join(stateDir, "intake");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const fd = openSync(path, "a", 0o600);
  try {
    chmodSync(path, 0o600);
    const line = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
    const written = writeSync(fd, line, 0, line.length);
    if (written !== line.length) throw new Error(`Incomplete usage intake append: wrote ${written} of ${line.length} bytes`);
  } finally {
    closeSync(fd);
  }
  return event;
}

function finiteNonNegative(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
  return value;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function parseEvent(value: unknown): UsageEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("record must be an object");
  const record = value as Record<string, unknown>;
  if (record.version !== USAGE_INTAKE_VERSION) throw new Error(`unsupported version ${String(record.version)}`);
  const eventUid = requiredText(record.event_uid, "event_uid");
  const rawTimestamp = requiredText(record.timestamp, "timestamp");
  const timestampMs = Date.parse(rawTimestamp);
  if (Number.isNaN(timestampMs)) throw new Error("timestamp must be a valid date");
  const operation = record.operation;
  if (operation !== "assistant" && operation !== "toolResult" && operation !== "compaction" && operation !== "branch_summary") {
    throw new Error("operation is invalid");
  }
  return {
    identity: createHash("sha256").update(`oh-my-pi-usage-intake-v1\0${eventUid}`).digest("hex"),
    timestamp: new Date(timestampMs).toISOString(),
    operation,
    provider: typeof record.provider === "string" ? record.provider : "",
    model: typeof record.model === "string" ? record.model : "",
    projectPath: typeof record.projectPath === "string" ? record.projectPath : "",
    input: finiteNonNegative(record.input, "input"),
    output: finiteNonNegative(record.output, "output"),
    cacheRead: finiteNonNegative(record.cacheRead, "cacheRead"),
    cacheWrite: finiteNonNegative(record.cacheWrite, "cacheWrite"),
    cost: finiteNonNegative(record.cost, "cost"),
    responses: finiteNonNegative(record.responses, "responses"),
  };
}

export function importUsageIntake(store: UsageStore, path = usageIntakePath()): UsageIntakeResult {
  const result: UsageIntakeResult = { added: 0, errors: [] };
  if (!existsSync(path)) return result;
  const data = readFileSync(path);
  const firstNewline = data.indexOf(10);
  const headerHash = createHash("sha256").update(data.subarray(0, firstNewline < 0 ? data.length : firstNewline)).digest("hex");
  const previous = store.source(path);
  let offset = previous && previous.headerHash === headerHash && previous.offset <= data.length ? previous.offset : 0;
  const tail = data.subarray(offset);
  const finalNewline = tail.lastIndexOf(10);
  if (finalNewline < 0) return result;
  const complete = tail.subarray(0, finalNewline + 1).toString("utf8");
  const firstLineNumber = data.subarray(0, offset).toString("utf8").split("\n").length;
  for (const [index, line] of complete.split("\n").entries()) {
    if (line.length === 0) continue;
    try {
      const event = parseEvent(JSON.parse(line));
      if (store.addEvent(event)) result.added++;
    } catch (error) {
      result.errors.push({ line: firstLineNumber + index, error: error instanceof Error ? error.message : String(error) });
    }
  }
  offset += Buffer.byteLength(complete);
  store.saveSource(path, { offset, headerHash });
  return result;
}
