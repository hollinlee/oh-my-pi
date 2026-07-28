import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCommandAllowed, createSandboxedBash, supportsSubagentSandbox } from "./sandbox.ts";
import type { SubagentTask } from "./schemas.ts";

function task(cwd: string, profile: SubagentTask["capability"]["profile"] = "workspace-write"): SubagentTask {
  return {
    id: "sandbox-test",
    objective: "test",
    acceptanceCriteria: [],
    context: [],
    scope: { cwd, includePaths: ["."], excludePaths: [] },
    capability: { profile },
    budget: "small",
    constraints: [],
    nonGoals: [],
    expectedOutput: "test",
  };
}

test("sandbox support is explicit and fail-closed by platform", () => {
  assert.equal(supportsSubagentSandbox("darwin"), true);
  assert.equal(supportsSubagentSandbox("linux"), true);
  assert.equal(supportsSubagentSandbox("win32"), false);
});

test("command policy blocks privilege, network, package, and git mutation", () => {
  const none = new Set<string>();
  assert.throws(() => assertCommandAllowed("sudo true", none), /privilege escalation/);
  assert.throws(() => assertCommandAllowed("curl https:\/\/example.com", none), /network/);
  assert.throws(() => assertCommandAllowed("npm install left-pad", none), /package installation/);
  assert.throws(() => assertCommandAllowed("git commit -am test", none), /git mutation/);
  assert.doesNotThrow(() => assertCommandAllowed("git status --short", none));
  assert.doesNotThrow(() => assertCommandAllowed("npm test", none));
  assert.doesNotThrow(() => assertCommandAllowed("git commit -am test", new Set(["git-mutation"])));
});

test("workspace-write fails closed for workspaces under the system temp directory", { skip: process.platform !== "darwin" && process.platform !== "linux" }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-temp-workspace-"));
  try {
    await assert.rejects(() => createSandboxedBash(task(cwd), cwd), /refuses workspaces under the system temp directory/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("read-only sandbox permits inspection and blocks workspace writes", { skip: process.platform !== "darwin" && process.platform !== "linux" }, async () => {
  const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-subagent-readonly-"));
  const sandbox = await createSandboxedBash(task(cwd, "read-only"), cwd);
  try {
    await sandbox.tool.execute("inspect", { command: "pwd" }, undefined, undefined, { cwd } as any);
    await assert.rejects(
      () => sandbox.tool.execute("write", { command: "printf denied > should-not-exist.txt" }, undefined, undefined, { cwd } as any),
      /Operation not permitted|Command exited with code/,
    );
    assert.equal(fs.existsSync(path.join(cwd, "should-not-exist.txt")), false);
  } finally {
    await sandbox.cleanup();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("OS sandbox allows workspace writes and blocks outside writes", { skip: process.platform !== "darwin" && process.platform !== "linux" }, async () => {
  const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-subagent-sandbox-"));
  const outside = path.join(os.tmpdir(), `subagent-escape-${Date.now()}.txt`);
  const sandbox = await createSandboxedBash(task(cwd), cwd);
  try {
    await sandbox.tool.execute("inside", { command: "printf inside > allowed.txt" }, undefined, undefined, { cwd } as any);
    assert.equal(fs.readFileSync(path.join(cwd, "allowed.txt"), "utf8"), "inside");
    const escapeCommands = [
      `printf escape > ${JSON.stringify(outside)}`,
      `sh -c ${JSON.stringify(`printf escape > ${outside}`)}`,
      `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(outside)}, 'escape')`)}`,
    ];
    for (const command of escapeCommands) {
      await assert.rejects(
        () => sandbox.tool.execute("outside", { command }, undefined, undefined, { cwd } as any),
        /Operation not permitted|Command exited with code/,
      );
      assert.equal(fs.existsSync(outside), false);
    }
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await assert.rejects(
      () => sandbox.tool.execute("aborted", { command: "printf should-not-run > aborted.txt" }, alreadyAborted.signal, undefined, { cwd } as any),
      /aborted/,
    );
    assert.equal(fs.existsSync(path.join(cwd, "aborted.txt")), false);
    await assert.rejects(
      () => sandbox.tool.execute(
        "network",
        { command: "node -e \"fetch('https://example.com').then(()=>process.exit(0)).catch(()=>process.exit(2))\"", timeout: 10 },
        undefined,
        undefined,
        { cwd } as any,
      ),
      /Command exited with code|timeout/,
    );
  } finally {
    await sandbox.cleanup();
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
