import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCommandAllowed, createSandboxedBash } from "./sandbox.ts";
import type { SubagentTask } from "./schemas.ts";

function task(cwd: string): SubagentTask {
  return {
    id: "sandbox-test",
    objective: "test",
    acceptanceCriteria: [],
    context: [],
    scope: { cwd, includePaths: ["."], excludePaths: [] },
    capability: { profile: "workspace-write" },
    budget: "small",
    constraints: [],
    nonGoals: [],
    expectedOutput: "test",
  };
}

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

test("OS sandbox allows workspace writes and blocks outside writes", { skip: process.platform !== "darwin" && process.platform !== "linux" }, async () => {
  const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-subagent-sandbox-"));
  const outside = path.join(os.tmpdir(), `subagent-escape-${Date.now()}.txt`);
  const sandbox = await createSandboxedBash(task(cwd));
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
