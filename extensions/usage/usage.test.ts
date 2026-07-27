import assert from "node:assert/strict";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { collectUsageEvent } from "./collector.ts";
import usageExtension from "./index.ts";
import { eventIdentity } from "./identity.ts";
import { scanSessions } from "./scanner.ts";
import { UsageStore } from "./store.ts";
import { formatTodaySummary } from "./summary.ts";

const timestamp = "2026-04-20T12:00:00.000Z";

function record(type: "assistant" | "toolResult" | "compaction" | "branch_summary", id: string, input = 10) {
  const usage = { input, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.125 } };
  if (type === "assistant" || type === "toolResult") {
    return {
      type: "message",
      id,
      timestamp,
      message: {
        role: type,
        provider: "provider",
        model: "model",
        content: [{ type: "text", text: "PRIVATE BODY" }],
        thinking: "PRIVATE THINKING",
        toolCall: { arguments: "PRIVATE ARGS", output: "PRIVATE OUTPUT" },
        usage,
      },
    };
  }
  return { type, id, timestamp, provider: "provider", model: "model", summary: "PRIVATE SUMMARY", usage };
}

function jsonl(...records: unknown[]): string {
  return records.map((value) => JSON.stringify(value)).join("\n") + "\n";
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oh-my-pi-usage-"));
  const sessions = join(root, "sessions");
  const state = join(root, "state");
  mkdirSync(sessions);
  const file = join(sessions, "session.jsonl");
  const header = { type: "session", version: 3, id: "session-a", timestamp, cwd: "/private/project" };
  return { root, sessions, state, file, header };
}

function withStore(run: (args: ReturnType<typeof fixture> & { store: UsageStore }) => void): void {
  const args = fixture();
  const store = new UsageStore(args.state);
  try {
    run({ ...args, store });
  } finally {
    store.close();
    rmSync(args.root, { recursive: true, force: true });
  }
}

test("collector projects assistant, toolResult, compaction, and branch_summary usage", () => {
  for (const operation of ["assistant", "toolResult", "compaction", "branch_summary"] as const) {
    const value = record(operation, operation);
    const event = collectUsageEvent(value, JSON.stringify(value), "/project");
    assert.ok(event);
    assert.equal(event.operation, operation);
    assert.equal(event.input, 10);
    assert.equal(event.output, 5);
    assert.equal(event.cacheRead, 2);
    assert.equal(event.cacheWrite, 1);
    assert.equal(event.cost, 0.125);
    assert.equal(event.responses, operation === "assistant" ? 1 : 0);
    assert.equal(event.projectPath, "/project");
  }
});

test("identity is stable for copied entries and separates reused ids by timestamp", () => {
  const value = record("assistant", "secret-entry-id");
  const first = eventIdentity(value, JSON.stringify(value));
  const copied = eventIdentity({ ...value }, JSON.stringify(value));
  const reused = eventIdentity({ ...value, timestamp: "2026-04-20T12:00:01.000Z" }, JSON.stringify(value));
  assert.equal(first, copied);
  assert.notEqual(first, reused);
  assert.equal(first.length, 64);
  assert.equal(first.includes("secret-entry-id"), false);
});

test("collector normalizes offset timestamps for range-safe storage", () => {
  const value = { ...record("assistant", "offset-time"), timestamp: "2026-04-20T20:00:00+08:00" };
  const event = collectUsageEvent(value, JSON.stringify(value), "/project");
  assert.equal(event?.timestamp, timestamp);
});

test("scanner is incremental and does not charge repeated or copied entries", () => withStore(({ sessions, file, state, header, store }) => {
  const assistant = record("assistant", "entry-a");
  writeFileSync(file, jsonl(header, assistant));
  assert.deepEqual(scanSessions(store, sessions), { files: 1, added: 1 });
  assert.deepEqual(scanSessions(store, sessions), { files: 1, added: 0 });

  const compaction = JSON.stringify(record("compaction", "entry-b", 20));
  appendFileSync(file, compaction.slice(0, 30));
  assert.equal(scanSessions(store, sessions).added, 0);
  appendFileSync(file, compaction.slice(30) + "\n");
  assert.equal(scanSessions(store, sessions).added, 1);

  const cloneDir = join(sessions, "clone");
  mkdirSync(cloneDir);
  copyFileSync(file, join(cloneDir, "fork.jsonl"));
  assert.equal(scanSessions(store, sessions).added, 0);
  assert.equal(store.eventCount(), 2);

  const columns = store.db.prepare("PRAGMA table_info(events)").all().map((row) => (row as { name: string }).name);
  assert.deepEqual(columns, ["identity", "timestamp", "operation", "provider", "model", "project_path", "input", "output", "cache_read", "cache_write", "cost", "responses"]);
  const sourceColumns = store.db.prepare("PRAGMA table_info(sources)").all().map((row) => (row as { name: string }).name);
  assert.deepEqual(sourceColumns, ["source_identity", "offset", "header_hash"]);
  const database = readFileSync(join(state, "usage.sqlite3"));
  for (const privateValue of ["PRIVATE BODY", "PRIVATE THINKING", "PRIVATE ARGS", "PRIVATE OUTPUT", file]) {
    assert.equal(database.includes(Buffer.from(privateValue)), false);
  }
}));

test("deleting a source session retains ledger events", () => withStore(({ sessions, file, header, store }) => {
  writeFileSync(file, jsonl(header, record("assistant", "retained")));
  scanSessions(store, sessions);
  rmSync(file);
  scanSessions(store, sessions);
  assert.equal(store.eventCount(), 1);
}));

test("state directory and database have private permissions", () => {
  const args = fixture();
  mkdirSync(args.state, { mode: 0o755 });
  const store = new UsageStore(args.state);
  try {
    assert.equal(statSync(args.state).mode & 0o777, 0o700);
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
  } finally {
    store.close();
    rmSync(args.root, { recursive: true, force: true });
  }
});

test("unknown and unversioned schemas fail closed without replacement", () => {
  for (const mode of ["unknown", "unversioned"] as const) {
    const args = fixture();
    mkdirSync(args.state);
    const path = join(args.state, "usage.sqlite3");
    const db = new DatabaseSync(path);
    if (mode === "unknown") db.exec("PRAGMA user_version = 99");
    else db.exec("CREATE TABLE foreign_data(secret TEXT); INSERT INTO foreign_data VALUES ('keep-me')");
    db.close();
    assert.throws(() => new UsageStore(args.state), mode === "unknown" ? /version 99/ : /Unversioned/);
    const verify = new DatabaseSync(path);
    if (mode === "unknown") assert.equal((verify.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 99);
    else assert.equal((verify.prepare("SELECT secret FROM foreign_data").get() as { secret: string }).secret, "keep-me");
    verify.close();
    rmSync(args.root, { recursive: true, force: true });
  }
});

test("summary uses all token components and assistant-only responses", () => {
  assert.equal(formatTodaySummary({ input: 80, output: 20, cacheRead: 20, cacheWrite: 5, cost: 1.25, responses: 3 }), [
    "Today",
    "Total: 125 tokens",
    "Input: 80",
    "Output: 20",
    "Cache hit rate: 20.0%",
    "Cost: $1.2500",
    "Responses: 3",
  ].join("\n"));
});

test("extension registers /usage and scans before showing today's summary", async () => {
  type Command = { handler: (args: string, ctx: { ui: { notify: (text: string, level: string) => void } }) => Promise<void> };
  let registration: { name: string; command: Command } | undefined;
  usageExtension({
    registerCommand(name: string, command: Command) {
      registration = { name, command };
    },
  } as never);
  assert.equal(registration?.name, "usage");

  const args = fixture();
  const current = { ...record("assistant", "command-entry"), timestamp: new Date().toISOString() };
  writeFileSync(args.file, jsonl(args.header, current));
  const oldState = process.env.OH_MY_PI_USAGE_STATE_DIR;
  const oldSessions = process.env.PI_SESSIONS_DIR;
  process.env.OH_MY_PI_USAGE_STATE_DIR = args.state;
  process.env.PI_SESSIONS_DIR = args.sessions;
  let notification = "";
  try {
    await registration?.command.handler("", { ui: { notify: (text) => { notification = text; } } });
    assert.match(notification, /^Today\nTotal: 18 tokens/m);
    assert.match(notification, /Cost: \$0\.1250\nResponses: 1$/);
  } finally {
    if (oldState === undefined) delete process.env.OH_MY_PI_USAGE_STATE_DIR;
    else process.env.OH_MY_PI_USAGE_STATE_DIR = oldState;
    if (oldSessions === undefined) delete process.env.PI_SESSIONS_DIR;
    else process.env.PI_SESSIONS_DIR = oldSessions;
    rmSync(args.root, { recursive: true, force: true });
  }
});
