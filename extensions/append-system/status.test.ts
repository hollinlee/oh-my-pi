import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAppendSystemFallback, getAppendSystemStatus } from "./status.ts";

function withFixture(run: (fixture: { root: string; cwd: string; agentDir: string; bundledPath: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "oh-my-pi-append-system-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const bundledPath = join(root, "bundled.md");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  writeFileSync(bundledPath, "Bundled rules\n", "utf8");
  try {
    run({ root, cwd, agentDir, bundledPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("uses the bundled fallback when no native append is configured", () => withFixture(({ cwd, agentDir, bundledPath }) => {
  const status = getAppendSystemStatus({ cwd, agentDir, bundledPath, projectTrusted: true, disabled: false });
  assert.equal(status.mode, "bundled");
  assert.equal(applyAppendSystemFallback("Base prompt", status), "Base prompt\n\nBundled rules");
}));

test("prefers a trusted project APPEND_SYSTEM.md", () => withFixture(({ cwd, agentDir, bundledPath }) => {
  const projectAppend = join(cwd, ".pi", "APPEND_SYSTEM.md");
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(projectAppend, "Project rules", "utf8");

  const status = getAppendSystemStatus({ cwd, agentDir, bundledPath, projectTrusted: true, disabled: false });
  assert.equal(status.mode, "local");
  assert.equal(status.path, projectAppend);
  assert.equal(applyAppendSystemFallback("Base prompt", status), "Base prompt");
}));

test("ignores an untrusted project file and prefers the global APPEND_SYSTEM.md", () => withFixture(({ cwd, agentDir, bundledPath }) => {
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "APPEND_SYSTEM.md"), "Project rules", "utf8");
  const globalAppend = join(agentDir, "APPEND_SYSTEM.md");
  writeFileSync(globalAppend, "Global rules", "utf8");

  const status = getAppendSystemStatus({ cwd, agentDir, bundledPath, projectTrusted: false, disabled: false });
  assert.equal(status.mode, "local");
  assert.equal(status.path, globalAppend);
}));

test("follows Pi agent-dir and disable environment variables", () => withFixture(({ cwd, agentDir, bundledPath }) => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousDisabled = process.env.OH_MY_PI_APPEND_SYSTEM_DISABLED;
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const globalAppend = join(agentDir, "APPEND_SYSTEM.md");
    writeFileSync(globalAppend, "Global rules", "utf8");
    assert.equal(getAppendSystemStatus({ cwd, bundledPath, projectTrusted: true }).path, globalAppend);

    process.env.OH_MY_PI_APPEND_SYSTEM_DISABLED = "1";
    assert.equal(getAppendSystemStatus({ cwd, bundledPath, projectTrusted: true }).mode, "disabled");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousDisabled === undefined) delete process.env.OH_MY_PI_APPEND_SYSTEM_DISABLED;
    else process.env.OH_MY_PI_APPEND_SYSTEM_DISABLED = previousDisabled;
  }
}));

test("does not duplicate a native or CLI append prompt", () => withFixture(({ cwd, agentDir, bundledPath }) => {
  const status = getAppendSystemStatus({
    cwd,
    agentDir,
    bundledPath,
    projectTrusted: true,
    nativeAppendConfigured: true,
    disabled: false,
  });
  assert.equal(status.mode, "local");
  assert.equal(applyAppendSystemFallback("Base with native append", status), "Base with native append");
}));

test("supports disabling the bundled fallback", () => withFixture(({ cwd, agentDir, bundledPath }) => {
  const status = getAppendSystemStatus({ cwd, agentDir, bundledPath, projectTrusted: true, disabled: true });
  assert.equal(status.mode, "disabled");
  assert.equal(applyAppendSystemFallback("Base prompt", status), "Base prompt");
}));

test("reports a missing bundled fallback", () => withFixture(({ cwd, agentDir, root }) => {
  const status = getAppendSystemStatus({
    cwd,
    agentDir,
    bundledPath: join(root, "missing.md"),
    projectTrusted: true,
    disabled: false,
  });
  assert.equal(status.mode, "unavailable");
}));
