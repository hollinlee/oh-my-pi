import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkUsageHealth } from "./health.ts";
import { writeUsageIntake } from "./intake.ts";
import { UsageStore } from "./store.ts";

function withUsageState(run: (stateDir: string, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "oh-my-pi-usage-doctor-"));
  const stateDir = join(root, "state");
  const previous = process.env.OH_MY_PI_USAGE_STATE_DIR;
  process.env.OH_MY_PI_USAGE_STATE_DIR = stateDir;
  try {
    run(stateDir, root);
  } finally {
    if (previous === undefined) delete process.env.OH_MY_PI_USAGE_STATE_DIR;
    else process.env.OH_MY_PI_USAGE_STATE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function labels(stateDir: string): string[] {
  assert.equal(process.env.OH_MY_PI_USAGE_STATE_DIR, stateDir);
  return checkUsageHealth().map((check) => `${check.severity}:${check.label}`);
}

test("usage doctor reports uninitialized state without creating it", () => withUsageState((stateDir) => {
  const checks = labels(stateDir);
  assert.ok(checks.includes("info:usage ledger not initialized"));
  assert.equal(existsSync(stateDir), false);
}));

test("usage doctor validates schema, permissions, and writability", () => withUsageState((stateDir) => {
  const store = new UsageStore(stateDir);
  store.close();
  writeUsageIntake({
    timestamp: "2026-04-20T12:00:00.000Z",
    operation: "assistant",
    provider: "provider",
    model: "model",
    projectPath: "/project",
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    cost: 0.5,
    responses: 1,
    eventUid: "doctor-event",
  }, stateDir);

  const checks = labels(stateDir);
  assert.ok(checks.includes("pass:usage ledger schema valid"));
  assert.ok(checks.includes("pass:usage state and files have private permissions"));
  assert.ok(checks.includes("pass:usage ledger and intake are writable"));

  chmodSync(join(stateDir, "intake", "usage-event-v1.jsonl"), 0o644);
  assert.ok(labels(stateDir).includes("fail:usage permissions are too broad"));
}));

test("usage doctor rejects symlinked intake paths without following them", () => withUsageState((stateDir, root) => {
  const outside = join(root, "outside");
  mkdirSync(stateDir, { mode: 0o700 });
  mkdirSync(outside, { mode: 0o700 });
  symlinkSync(outside, join(stateDir, "intake"));

  const checks = labels(stateDir);
  assert.ok(checks.includes("fail:usage state contains unsafe paths"));
}));
