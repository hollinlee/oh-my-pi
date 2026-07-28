import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { queryUsageDashboard, usageTimeRange, type UsageDashboardSnapshot, type UsageRange } from "./dashboard-data.ts";
import { loadUsageDashboard } from "./dashboard-loader.ts";
import { UsageStore } from "./store.ts";
import { UsageDashboard } from "./usage-dashboard.ts";

function temporaryDirs() {
  const root = mkdtempSync(join(tmpdir(), "usage-dashboard-"));
  const stateDir = join(root, "state");
  const sessionsDir = join(root, "sessions");
  mkdirSync(sessionsDir);
  return { root, stateDir, sessionsDir, intakePath: join(root, "missing-intake.jsonl") };
}

function withTimeZone<T>(zone: string, run: () => T): T {
  const old = process.env.TZ;
  process.env.TZ = zone;
  try { return run(); } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
}

test("dashboard time ranges use local boundaries across DST and retain empty buckets", () => withTimeZone("America/New_York", () => {
  assert.equal(usageTimeRange("today", new Date("2026-03-08T16:00:00Z")).buckets.length, 23);
  assert.equal(usageTimeRange("today", new Date("2026-11-01T17:00:00Z")).buckets.length, 25);
  const sevenDays = usageTimeRange("7d", new Date("2026-03-10T16:00:00Z"));
  assert.equal(sevenDays.buckets.length, 7);
  assert.equal(sevenDays.from.getHours(), 0);
  assert.equal(sevenDays.to.getHours(), 0);

  const dirs = temporaryDirs();
  const store = new UsageStore(dirs.stateDir);
  try {
    const snapshot = queryUsageDashboard(store, "7d", new Date("2026-03-10T16:00:00Z"));
    assert.equal(snapshot.buckets.length, 7);
    assert.deepEqual(snapshot.buckets.map((bucket) => bucket.total), Array(7).fill(0));
  } finally {
    store.close();
    rmSync(dirs.root, { recursive: true, force: true });
  }
}));

test("dashboard groups models, providers, and projects without changing ledger semantics", () => {
  const dirs = temporaryDirs();
  const store = new UsageStore(dirs.stateDir);
  try {
    const base = {
      timestamp: "2026-04-20T12:00:00.000Z", operation: "assistant" as const,
      input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: 0.1, responses: 1,
    };
    store.addEvent({ ...base, identity: "a", provider: "openai", model: "gpt", projectPath: "/alpha" });
    store.addEvent({ ...base, identity: "b", provider: "openai", model: "gpt", projectPath: "/beta" });
    store.addEvent({ ...base, identity: "c", operation: "toolResult", provider: "", model: "", projectPath: "", responses: 0 });
    const snapshot = queryUsageDashboard(store, "today", new Date("2026-04-20T14:00:00Z"));
    const plain = (kind: "models" | "providers" | "projects") => snapshot.breakdowns[kind].map((entry) => ({ ...entry }));
    assert.deepEqual(plain("models"), [{ label: "openai/gpt", total: 36 }, { label: "Tools/summaries", total: 18 }]);
    assert.deepEqual(plain("providers"), [{ label: "openai", total: 36 }, { label: "Tools/summaries", total: 18 }]);
    assert.deepEqual(plain("projects"), [
      { label: "/alpha", total: 18 }, { label: "/beta", total: 18 }, { label: "Unknown project", total: 18 },
    ]);
  } finally {
    store.close();
    rmSync(dirs.root, { recursive: true, force: true });
  }
});

test("worker loader returns snapshots from temporary state and sessions", async () => {
  const dirs = temporaryDirs();
  try {
    const result = await loadUsageDashboard({ ...dirs, range: "today", now: new Date("2026-04-20T12:00:00Z") });
    assert.equal(result.intakeErrors, 0);
    assert.equal(result.snapshot.range, "today");
    assert.equal(result.snapshot.buckets.length, 24);
  } finally {
    rmSync(dirs.root, { recursive: true, force: true });
  }
});

test("worker loader aborts by terminating and rejecting AbortError", async () => {
  const listeners = new Map<string, (...args: any[]) => void>();
  let terminated = false;
  const worker = {
    once(name: string, listener: (...args: any[]) => void) { listeners.set(name, listener); },
    removeAllListeners() { listeners.clear(); },
    async terminate() { terminated = true; return 1; },
  };
  const controller = new AbortController();
  const loading = loadUsageDashboard({
    stateDir: "state", sessionsDir: "sessions", intakePath: "intake", range: "today", signal: controller.signal,
  }, () => worker as never);
  controller.abort();
  await assert.rejects(loading, (error: any) => error?.name === "AbortError");
  assert.equal(terminated, true);
});

test("worker loader settles worker errors and exits without a response", async () => {
  function fakeWorker() {
    const listeners = new Map<string, (...args: any[]) => void>();
    return {
      listeners,
      worker: {
        once(name: string, listener: (...args: any[]) => void) { listeners.set(name, listener); },
        removeAllListeners() { listeners.clear(); },
        async terminate() { return 1; },
      },
    };
  }
  const options = { stateDir: "state", sessionsDir: "sessions", intakePath: "intake", range: "today" as const };
  const failed = fakeWorker();
  const errorPromise = loadUsageDashboard(options, () => failed.worker as never);
  failed.listeners.get("error")!(new Error("worker failed"));
  await assert.rejects(errorPromise, /worker failed/);

  const exited = fakeWorker();
  const exitPromise = loadUsageDashboard(options, () => exited.worker as never);
  exited.listeners.get("exit")!(0);
  await assert.rejects(exitPromise, /without a response/);
});

function snapshot(range: UsageRange): UsageDashboardSnapshot {
  const buckets = Array.from({ length: range === "today" ? 24 : range === "7d" ? 7 : 30 }, (_, index) => ({
    from: new Date(2026, 3, index + 1).toISOString(),
    to: new Date(2026, 3, index + 2).toISOString(),
    label: `bucket-${index}`,
    total: index * 100,
  }));
  return {
    range, from: buckets[0]!.from, to: buckets.at(-1)!.to, generatedAt: new Date().toISOString(),
    totals: { input: 1000, output: 200, cacheRead: 300, cacheWrite: 50, cost: 1.25, responses: 9 },
    buckets,
    breakdowns: {
      models: [{ label: "provider/a-very-long-model-name", total: 900 }],
      providers: [{ label: "provider", total: 900 }],
      projects: [{ label: "/a/very/long/project/path/that/must/be/truncated", total: 900 }],
    },
  };
}

function deferredLoader() {
  const calls: Array<{ options: any; resolve: (value: any) => void }> = [];
  return {
    calls,
    loader: (options: any) => new Promise<any>((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      calls.push({ options, resolve });
    }),
  };
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

async function tick(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test("dashboard keys change range and breakdown, refresh, and Esc cancels and closes", async () => {
  const pending = deferredLoader();
  let renders = 0;
  let closed = 0;
  const view = new UsageDashboard({ requestRender: () => { renders++; } }, theme, () => { closed++; }, {
    stateDir: "state", sessionsDir: "sessions", intakePath: "intake",
  }, pending.loader);
  assert.equal(pending.calls.length, 1);

  view.handleInput("2");
  assert.equal(view.selectedRange, "7d");
  assert.equal(pending.calls[0]!.options.signal.aborted, true);
  assert.equal(pending.calls.length, 2);
  pending.calls[1]!.resolve({ snapshot: snapshot("7d"), intakeErrors: 0 });
  await tick();
  assert.equal(view.status, "ready");

  view.handleInput("\t");
  assert.equal(view.selectedBreakdown, "providers");
  view.handleInput("r");
  assert.equal(pending.calls.length, 3);
  view.handleInput("\x1b");
  assert.equal(pending.calls[2]!.options.signal.aborted, true);
  assert.equal(closed, 1);
  assert.ok(renders > 0);
});

test("dashboard p uses the purge callback, leaves cancellation untouched, and refreshes after purge", async () => {
  const pending = deferredLoader();
  const decisions: boolean[] = [false, true];
  let purgeCalls = 0;
  const view = new UsageDashboard({ requestRender() {} }, theme, () => undefined, {
    stateDir: "state", sessionsDir: "sessions", intakePath: "intake",
  }, pending.loader, async () => {
    purgeCalls++;
    return decisions.shift()!;
  });
  pending.calls[0]!.resolve({ snapshot: snapshot("today"), intakeErrors: 0 });
  await tick();

  view.handleInput("p");
  await tick();
  assert.equal(purgeCalls, 1);
  assert.equal(pending.calls.length, 1, "cancelled purge must not refresh or mutate the ledger");
  assert.equal(view.status, "ready");

  view.handleInput("p");
  await tick();
  assert.equal(purgeCalls, 2);
  assert.equal(pending.calls.length, 2);
  assert.equal(view.status, "loading");
  view.dispose();
});

test("dashboard renders summary, total chart, breakdown essentials within terminal bounds", async () => {
  const loader = async ({ range }: { range: UsageRange }) => ({ snapshot: snapshot(range), intakeErrors: 0 });
  const view = new UsageDashboard({ requestRender() {} }, theme, () => undefined, {
    stateDir: "state", sessionsDir: "sessions", intakePath: "intake",
  }, loader as any);
  await tick();

  for (const [width, height] of [[120, 40], [80, 24], [72, 24]] as const) {
    const lines = view.render(width);
    assert.ok(lines.length <= height, `${width}x${height} rendered ${lines.length} lines`);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    const text = lines.join("\n");
    assert.match(text, /Summary/);
    assert.match(text, /Total by time/);
    assert.match(text, /Models breakdown/);
    assert.match(text, /Cost \$1\.25/);
    assert.match(text, /Hit 23\.1%/);
    assert.match(text, /#+/);
  }
  view.dispose();
});
