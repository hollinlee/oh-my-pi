import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseSkillFrontmatter } from "../lib/skill-frontmatter.ts";

const skillPath = fileURLToPath(new URL("../../skills/frontend-design/SKILL.md", import.meta.url));
const skillDir = dirname(skillPath);
const skill = await readFile(skillPath, "utf8");
const baseline = await readFile(resolve(skillDir, "references/baseline.md"), "utf8");
const provenance = await readFile(resolve(skillDir, "references/provenance.md"), "utf8");
const license = await readFile(resolve(skillDir, "LICENSE.anthropic.txt"), "utf8");
const frontmatter = parseSkillFrontmatter(skill);

function markdownLinks(text: string): string[] {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
}

test("frontend design skill has valid, narrow Agent Skills frontmatter", () => {
  assert.equal(frontmatter?.name, "frontend-design");
  const description = frontmatter?.description ?? "";
  assert.ok(description.length > 0 && description.length <= 1024);
  assert.match(description, /landing page/);
  assert.match(description, /个人网站/);
  assert.match(description, /redesign/);
  assert.match(description, /纯业务逻辑/);
  assert.match(description, /普通 frontend bugfix/);
  assert.match(description, /独立 accessibility\/design-system audit/);
});

test("frontend design workflow requires the compact design contract", () => {
  for (const field of [
    "Primary direction",
    "Treatments",
    "Tokens",
    "Signature",
    "Defaults rejected",
  ]) {
    assert.match(skill, new RegExp(field));
  }
  assert.match(skill, /编码前/);
  assert.match(skill, /只有多个方向会导致实质不同结果时才问用户一个关键问题/);
});

test("baseline covers subject-grounded design and anti-template principles", () => {
  for (const concept of [
    "subject",
    "audience",
    "page job",
    "Typography",
    "Structure",
    "Motion",
    "Complexity",
    "Signature",
    "Anti-template",
  ]) {
    assert.match(baseline, new RegExp(concept, "i"));
  }
  assert.match(baseline, /card-border-shadow/);
  assert.match(baseline, /无信息量文案/);
});

test("all local Markdown references from the skill exist", async () => {
  const links = markdownLinks(skill);
  assert.ok(links.length >= 2);
  for (const link of links) {
    await access(resolve(skillDir, link));
  }
});

test("Anthropic provenance is pinned and carries the Apache license", () => {
  assert.match(provenance, /2235be7c60b551f5de82ade908fd3816455afcda/);
  assert.match(provenance, /1608ea77fbb6fc30d13a97d12cfa8ebf31358d40f0dd97beed24829d6b3f45dd/);
  assert.match(provenance, /不是上游文件的逐字镜像/);
  assert.match(provenance, /人工 semantic review/);
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0/);
});
