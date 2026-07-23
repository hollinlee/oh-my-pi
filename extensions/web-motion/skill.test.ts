import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseSkillFrontmatter } from "../lib/skill-frontmatter.ts";

const skillPath = fileURLToPath(new URL("../../skills/web-motion/SKILL.md", import.meta.url));
const skillDir = dirname(skillPath);
const skill = await readFile(skillPath, "utf8");
const selection = await readFile(resolve(skillDir, "references/technology-selection.md"), "utf8");
const quality = await readFile(resolve(skillDir, "references/quality-check.md"), "utf8");
const evalCases = await readFile(resolve(skillDir, "evals/cases.md"), "utf8");
const frontmatter = parseSkillFrontmatter(skill);

function markdownLinks(text: string): string[] {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("web motion skill has valid, narrow Agent Skills frontmatter", () => {
  assert.equal(frontmatter?.name, "web-motion");
  const description = frontmatter?.description ?? "";
  assert.ok(description.length > 0 && description.length <= 1024);
  for (const term of ["粒子", "Lottie", "GSAP", "Three.js", "普通 UI 实现", "独立性能/a11y audit"]) {
    assert.match(description, new RegExp(escapeRegExp(term)));
  }
});

test("web motion owns implementation decisions without replacing visual direction", () => {
  assert.match(skill, /frontend-design.*整体视觉语言/);
  assert.match(skill, /只负责 motion 的角色、技术和实现约束/);
  assert.match(skill, /不要用动画数量代替视觉方向/);
  assert.match(skill, /默认只新增一个主要 motion runtime/);
});

test("motion contract covers role, engine, behavior, budget, and reduced mode", () => {
  for (const field of ["Motion role", "Engine", "Behavior", "Budget", "Reduced mode"]) {
    assert.match(skill, new RegExp(field));
  }
  assert.match(skill, /编码前/);
  assert.match(skill, /一个页面只保留一个主要 motion signature/);
});

test("all local Markdown references from the skill exist", async () => {
  const links = markdownLinks(skill);
  assert.equal(links.length, 2);
  for (const link of links) await access(resolve(skillDir, link));
});

test("technology selection chooses the lightest suitable runtime", () => {
  for (const technology of [
    "CSS transition / animation",
    "Motion",
    "React Spring",
    "GSAP",
    "Lottie",
    "Rive",
    "PixiJS",
    "Three.js",
  ]) {
    assert.match(selection, new RegExp(escapeRegExp(technology)));
  }
  assert.match(selection, /只有需要 3D 深度、景深、相机穿越或 shader 风场时用 Three\.js/);
  assert.match(skill, /同一类 DOM 动画/);
  assert.match(selection, /每个 runtime 的唯一职责和生命周期 owner/);
});

test("quality check covers reduced motion, lifecycle, mobile, and honest verification", () => {
  for (const term of [
    "prefers-reduced-motion",
    "移动端 viewport",
    "device pixel ratio",
    "hidden/offscreen/unmount",
    "dispose",
    "motion-render-verified",
    "motion-code-checked",
  ]) {
    assert.match(`${skill}\n${quality}`, new RegExp(term));
  }
  assert.match(skill, /不得声称动效流畅、视觉已验收或性能达标/);
});

test("evaluation cases cover positive, negative, and boundary routing", () => {
  for (const prompt of [
    "飘落樱花",
    "惯性回弹",
    "GSAP",
    "dotLottie",
    "R3F shader 星空",
    "dashboard 的 API",
    "二次元首页",
    "页面更有活力一点",
    "偶发不执行",
  ]) {
    assert.match(evalCases, new RegExp(prompt));
  }
  assert.match(evalCases, /仅因风格词不触发 web-motion/);
  assert.match(evalCases, /属于 diagnosing-bugs/);
});
