import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensurePrivateTranscriptPermissions, runSubagent } from "./runtime.ts";
import type { SubagentTask } from "./schemas.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

test("sidechain transcript is materialized with owner-only permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-transcript-"));
  const transcript = path.join(directory, "child.jsonl");
  try {
    fs.writeFileSync(transcript, "");
    assert.equal(ensurePrivateTranscriptPermissions(transcript), true);
    assert.equal(fs.existsSync(transcript), true);
    assert.equal(fs.statSync(transcript).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("single write dispatch returns needs-context before child startup for dirty tracked source", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-runtime-dirty-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(root, "tracked.txt"), "clean\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-qm", "initial");
  fs.writeFileSync(path.join(root, "tracked.txt"), "dirty\n");
  const task: SubagentTask = {
    id: "dirty-single",
    objective: "write",
    acceptanceCriteria: [],
    context: [],
    scope: { cwd: root, includePaths: ["tracked.txt"] },
    capability: { profile: "workspace-write" },
    budget: "small",
    constraints: [],
    nonGoals: [],
    expectedOutput: "write",
  };
  const sessionId = `runtime-preflight-${Date.now()}`;
  try {
    const result = await runSubagent(
      task,
      "small",
      { cwd: root, sessionManager: { getSessionId: () => sessionId } } as any,
      undefined,
      () => {},
      () => () => {},
    );
    assert.equal(result.status, "needs-context");
    assert.equal(result.usage.turns, 0);
    assert.equal(result.usage.toolCalls, 0);
    assert.match(result.result?.summary ?? "", /Commit or stash.*parent session/);
    assert.equal(result.transcriptPath, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(os.homedir(), ".pi", "agent", "subagents", "sessions", sessionId), { recursive: true, force: true });
  }
});
