import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CapabilityViolation, createPathPolicy } from "./capability.ts";
import type { SubagentTask } from "./schemas.ts";

function task(cwd: string, includePaths = ["src"], excludePaths = ["src/private"]): SubagentTask {
  return {
    id: "policy-test",
    objective: "test",
    acceptanceCriteria: [],
    context: [],
    scope: { cwd, includePaths, excludePaths },
    capability: { profile: "workspace-write" },
    budget: "small",
    constraints: [],
    nonGoals: [],
    expectedOutput: "test",
  };
}

test("path policy permits included paths and denies traversal/excludes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-policy-"));
  fs.mkdirSync(path.join(root, "src", "private"), { recursive: true });
  const policy = createPathPolicy(task(root));
  assert.equal(policy.assertPath("src/file.ts", "write"), path.join(fs.realpathSync.native(root), "src", "file.ts"));
  assert.throws(() => policy.assertPath("../escape.txt", "write"), CapabilityViolation);
  assert.throws(() => policy.assertPath("src/private/key.txt", "read"), CapabilityViolation);
  fs.rmSync(root, { recursive: true, force: true });
});

test("path policy prevents symlink escape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-policy-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-outside-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "src", "link"));
  const policy = createPathPolicy(task(root, ["src"], []));
  assert.throws(() => policy.assertPath("src/link/secret.txt", "read"), CapabilityViolation);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("outside include path requires an explicit override", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-policy-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-outside-"));
  assert.throws(() => createPathPolicy(task(root, [outside], [])), CapabilityViolation);
  const elevated = task(root, [outside], []);
  elevated.capability = { profile: "elevated", overrides: ["repo-outside"] };
  assert.doesNotThrow(() => createPathPolicy(elevated));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
