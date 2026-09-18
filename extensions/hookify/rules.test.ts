import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  loadHookifyRules,
  matchingHookifyRules,
  parseHookifyRule,
  selectHookifyRule,
} from "./rules.ts";

function document(fields: Record<string, string>, body = ""): string {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n${body}`;
}

function tempProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-my-pi-hookify-rules-"));
  mkdirSync(path.join(root, ".pi", "hookify"), { recursive: true });
  return root;
}

function writeRule(root: string, name: string, fields: Record<string, string>, body = ""): string {
  const filePath = path.join(root, ".pi", "hookify", name);
  writeFileSync(filePath, document(fields, body), "utf8");
  return filePath;
}

test("parses bash rule frontmatter and uses the body as a fallback message", () => {
  const rule = parseHookifyRule(
    document({ event: "bash", pattern: "rm[ ]+-rf", action: "block", flags: "i", priority: "7" }, "Do not remove files."),
    "/project/.pi/hookify/remove.md",
  );
  assert.equal(rule.name, "remove");
  assert.equal(rule.event, "bash");
  assert.equal(rule.action, "block");
  assert.equal(rule.priority, 7);
  assert.equal(rule.expression.test("RM -RF tmp"), true);
  assert.equal(rule.message, "Do not remove files.");
});

test("falls back to the rule name when no message or body is provided", () => {
  const rule = parseHookifyRule(document({ name: "named-rule", pattern: "danger", action: "block" }), "/project/named.md");
  assert.equal(rule.message, "named-rule");
});

test("supports match and tool aliases but rejects non-bash and unknown actions", () => {
  const rule = parseHookifyRule(document({ tool: "bash", match: "secret", action: "warn" }), "/project/rule.md");
  assert.equal(rule.pattern, "secret");
  assert.throws(() => parseHookifyRule(document({ event: "read", pattern: "secret", action: "warn" }), "/project/read.md"), /event must be bash/);
  assert.throws(() => parseHookifyRule(document({ pattern: "secret", action: "allow" }), "/project/allow.md"), /action must be one of/);
});

test("isolates malformed rules and keeps valid rules loaded", () => {
  const root = tempProject();
  try {
    writeRule(root, "bad.md", { pattern: "[", action: "block" });
    writeRule(root, "good.md", { pattern: "npm test", action: "warn" });
    const loaded = loadHookifyRules(root);
    assert.equal(loaded.rules.length, 1);
    assert.equal(loaded.rules[0]?.name, "good");
    assert.equal(loaded.diagnostics.length, 1);
    assert.match(loaded.diagnostics[0]?.reason ?? "", /invalid pattern/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selects the most restrictive action before priority and remains deterministic", () => {
  const warn = parseHookifyRule(document({ name: "warn", pattern: "danger", action: "warn", priority: "100" }), "/project/warn.md");
  const block = parseHookifyRule(document({ name: "block", pattern: "danger", action: "block", priority: "-100" }), "/project/block.md");
  const first = parseHookifyRule(document({ name: "first", pattern: "danger", action: "confirm", priority: "1" }), "/project/first.md");
  const second = parseHookifyRule(document({ name: "second", pattern: "danger", action: "confirm", priority: "2" }), "/project/second.md");
  assert.equal(selectHookifyRule([warn, block])?.name, "block");
  assert.equal(selectHookifyRule([first, second])?.name, "second");
  assert.equal(matchingHookifyRules([warn, block], "safe command").length, 0);
});
