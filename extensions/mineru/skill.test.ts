import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseSkillFrontmatter } from "../skill-frontmatter.ts";

const skillPath = fileURLToPath(new URL("../../skills/mineru-document-parsing/SKILL.md", import.meta.url));
const skill = await readFile(skillPath, "utf8");
const frontmatter = parseSkillFrontmatter(skill);

test("MinerU routing skill has valid, bounded Agent Skills frontmatter", () => {
  assert.equal(frontmatter?.name, "mineru-document-parsing");
  const description = frontmatter?.description ?? "";
  assert.ok(description.length > 0 && description.length <= 1024);
  assert.match(description, /PDF/);
  assert.match(description, /普通代码/);
  assert.match(description, /明确指定/);
});

test("routing rules cover model, OCR, language, and explicit overrides", () => {
  assert.match(skill, /一般解析[^\n]*\| `vlm`/);
  assert.match(skill, /逐字[^\n]*\| `pipeline`/);
  assert.match(skill, /图片[^\n]*\|[^\n]*`true`/);
  assert.match(skill, /PDF 或 Office[^\n]*\|[^\n]*`false`/);
  assert.match(skill, /扫描件[^\n]*\|[^\n]*`true`/);
  assert.match(skill, /明确英文[^\n]*`en`/);
  assert.match(skill, /尊重用户显式指定/);
  assert.match(skill, /不要做本地语言自动检测/);
});

test("skill forbids implicit upload, fallback, and unbounded context reads", () => {
  assert.match(skill, /不授权扫描目录/);
  assert.match(skill, /不要自动 fallback/);
  assert.match(skill, /不得重提/);
  assert.match(skill, /mineru_parse\(job_id=\.\.\.\)/);
  assert.match(skill, /rg -n --/);
  assert.match(skill, /`offset` \/ `limit`/);
  assert.match(skill, /不使用 `cat`/);
});

test("skill states spreadsheet and VLM verification boundaries", () => {
  assert.match(skill, /关键金额、日期、名称、条款或结论/);
  assert.match(skill, /公式、宏、隐藏 sheet、named ranges/);
  assert.match(skill, /不是逐字权威来源/);
});
