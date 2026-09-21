import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const prompt = read("prompts/ship-changes.md");
const skill = read("skills/github-workflow/SKILL.md");
const workflow = read("skills/github-workflow/references/ship-changes.md");
const pr = read("skills/github-workflow/references/pr.md");
const review = read("skills/github-workflow/references/review.md");
const merge = read("skills/github-workflow/references/merge.md");

test("ship-changes is a discoverable recovery entry for existing implementation", () => {
  assert.match(prompt, /description: .*补建 issue/);
  assert.match(skill, /`\/ship-changes`：从当前已有 diff\/commits/);
  assert.match(workflow, /implementation 已经发生/);
});

test("ship-changes has one issue gate and preserves base history", () => {
  assert.match(prompt, /创建 issue 前只保留一次 human gate/);
  assert.match(workflow, /确认同时授权.*issue creation.*squash merge/s);
  for (const operation of ["reset base branch", "rebase", "cherry-pick", "force push"]) {
    assert.match(workflow, new RegExp(operation));
  }
});

test("ship-changes continues through PR, review, and authoritative merge gates", () => {
  assert.match(pr, /`\/ship-changes`/);
  assert.match(review, /`\/ship-changes`/);
  assert.match(merge, /`\/ship-changes`/);
  assert.match(merge, /authoritative blocking conditions/);
  assert.match(review, /Required CI、blocking human review 和 agent verification/);
});
