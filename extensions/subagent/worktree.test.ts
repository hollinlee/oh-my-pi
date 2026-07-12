import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareIsolation } from "./worktree.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function createRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-repo-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(root, "tracked.txt"), "before\n");
  fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  git(root, "add", "tracked.txt", "binary.bin");
  git(root, "commit", "-qm", "initial");
  return root;
}

test("git worktree handoff preserves parent and captures tracked/untracked changes", async () => {
  const root = createRepo();
  const isolation = await prepareIsolation(root, "handoff-test");
  assert.equal(isolation.handoff.mode, "git-worktree");
  fs.writeFileSync(path.join(isolation.cwd, "tracked.txt"), "after\n");
  fs.writeFileSync(path.join(isolation.cwd, "binary.bin"), Buffer.from([0, 9, 8, 7]));
  fs.writeFileSync(path.join(isolation.cwd, "new.txt"), "new\n");
  const handoff = await isolation.finalize();
  assert.equal(fs.readFileSync(path.join(root, "tracked.txt"), "utf8"), "before\n");
  assert.equal(handoff.state, "handoff-ready");
  assert.equal(handoff.retained, true);
  assert.ok(handoff.changedPaths.includes("tracked.txt"));
  assert.ok(handoff.untrackedPaths.includes("new.txt"));
  assert.ok(handoff.binaryPaths.includes("binary.bin"));
  assert.ok(handoff.patchArtifact && fs.existsSync(handoff.patchArtifact));
  const patch = fs.readFileSync(handoff.patchArtifact!, "utf8");
  assert.match(patch, /tracked\.txt/);
  assert.match(patch, /new\.txt/);
  git(root, "worktree", "remove", "--force", handoff.workspacePath);
  git(root, "branch", "-D", handoff.branch!);
  fs.rmSync(handoff.patchArtifact!, { force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("dirty source worktree is rejected instead of silently dropping parent changes", async () => {
  const root = createRepo();
  fs.writeFileSync(path.join(root, "tracked.txt"), "dirty\n");
  await assert.rejects(() => prepareIsolation(root, "dirty-test"), /requires a clean source worktree/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("clean git isolation is removed automatically", async () => {
  const root = createRepo();
  const isolation = await prepareIsolation(root, "clean-test");
  const workspace = isolation.handoff.workspacePath;
  const branch = isolation.handoff.branch!;
  const handoff = await isolation.finalize();
  assert.equal(handoff.state, "cleaned");
  assert.equal(handoff.retained, false);
  assert.equal(fs.existsSync(workspace), false);
  assert.notEqual(spawnSync("git", ["-C", root, "show-ref", "--verify", `refs/heads/${branch}`]).status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("non-git source uses an isolated directory copy", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-copy-source-"));
  fs.writeFileSync(path.join(source, "file.txt"), "before");
  const isolation = await prepareIsolation(source, "copy-test");
  assert.equal(isolation.handoff.mode, "directory-copy");
  fs.writeFileSync(path.join(isolation.cwd, "file.txt"), "after");
  const handoff = await isolation.finalize();
  assert.equal(fs.readFileSync(path.join(source, "file.txt"), "utf8"), "before");
  assert.equal(handoff.state, "handoff-ready");
  assert.ok(handoff.changedPaths.includes("file.txt"));
  fs.rmSync(handoff.workspacePath, { recursive: true, force: true });
  fs.rmSync(source, { recursive: true, force: true });
});
