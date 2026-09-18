import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter } from "../lib/skill-frontmatter.ts";

export const HOOKIFY_DIRECTORY = path.join(".pi", "hookify");
export const MAX_RULE_FILES = 32;
export const MAX_RULE_BYTES = 64 * 1024;
export const MAX_RULES = 64;
export const MAX_PATTERN_LENGTH = 2_000;
export const MAX_MESSAGE_LENGTH = 1_000;

const VALID_FLAGS = /^[imsu]*$/;
const ACTION_RANK: Record<HookifyAction, number> = { warn: 1, confirm: 2, block: 3 };

export type HookifyAction = "warn" | "confirm" | "block";

export type HookifyRule = {
  name: string;
  filePath: string;
  event: "bash";
  pattern: string;
  flags: string;
  expression: RegExp;
  action: HookifyAction;
  priority: number;
  message: string;
};

export type HookifyDiagnostic = {
  filePath: string;
  reason: string;
};

export type HookifyLoadResult = {
  rules: HookifyRule[];
  diagnostics: HookifyDiagnostic[];
};

function bounded(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function documentBody(text: string): string {
  if (!text.startsWith("---\n")) return "";
  const end = text.indexOf("\n---", 4);
  return end < 0 ? "" : text.slice(end + "\n---".length).trim();
}

function stringField(frontmatter: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = frontmatter[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parsePriority(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -10_000 || parsed > 10_000) {
    throw new Error("priority must be an integer between -10000 and 10000");
  }
  return parsed;
}

function parseAction(value: string | undefined): HookifyAction {
  if (value === "warn" || value === "confirm" || value === "block") return value;
  throw new Error("action must be one of warn, confirm, or block");
}

export function parseHookifyRule(text: string, filePath: string): HookifyRule {
  const frontmatter = parseSkillFrontmatter(text);
  if (!frontmatter) throw new Error("missing or malformed frontmatter");

  const name = stringField(frontmatter, "name") ?? path.basename(filePath, path.extname(filePath));
  const event = stringField(frontmatter, "event", "tool") ?? "bash";
  if (event !== "bash") throw new Error(`event must be bash, got ${event}`);

  const pattern = stringField(frontmatter, "pattern", "match");
  if (!pattern) throw new Error("pattern is required");
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error(`pattern exceeds ${MAX_PATTERN_LENGTH} characters`);

  const flags = frontmatter.flags?.trim() ?? "";
  if (!VALID_FLAGS.test(flags)) throw new Error("flags may only contain i, m, s, and u");

  let expression: RegExp;
  try {
    expression = new RegExp(pattern, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid pattern: ${message}`);
  }

  const action = parseAction(frontmatter.action?.trim().toLowerCase());
  const message = bounded(stringField(frontmatter, "message", "description") ?? (documentBody(text) || name), MAX_MESSAGE_LENGTH);
  return {
    name: bounded(name, 200),
    filePath,
    event: "bash",
    pattern,
    flags,
    expression,
    action,
    priority: parsePriority(frontmatter.priority),
    message,
  };
}

export function loadHookifyRules(cwd: string): HookifyLoadResult {
  const directory = path.join(cwd, HOOKIFY_DIRECTORY);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { rules: [], diagnostics: [] };
    const reason = error instanceof Error ? error.message : String(error);
    return { rules: [], diagnostics: [{ filePath: directory, reason: `cannot read rule directory: ${reason}` }] };
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const diagnostics: HookifyDiagnostic[] = [];
  const rules: HookifyRule[] = [];

  if (candidates.length > MAX_RULE_FILES) {
    diagnostics.push({ filePath: directory, reason: `only the first ${MAX_RULE_FILES} .md files are loaded` });
  }

  for (const entry of candidates.slice(0, MAX_RULE_FILES)) {
    const filePath = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_RULE_BYTES) {
        diagnostics.push({ filePath, reason: `file exceeds ${MAX_RULE_BYTES} bytes` });
        continue;
      }
      const text = fs.readFileSync(filePath, "utf8");
      rules.push(parseHookifyRule(text, filePath));
      if (rules.length >= MAX_RULES) {
        diagnostics.push({ filePath: directory, reason: `only the first ${MAX_RULES} valid rules are loaded` });
        break;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      diagnostics.push({ filePath, reason });
    }
  }

  return { rules, diagnostics };
}

export function matchingHookifyRules(rules: readonly HookifyRule[], command: string): HookifyRule[] {
  return rules.filter((rule) => {
    rule.expression.lastIndex = 0;
    return rule.expression.test(command);
  });
}

export function compareHookifyRules(left: HookifyRule, right: HookifyRule): number {
  return (
    ACTION_RANK[right.action] - ACTION_RANK[left.action]
    || right.priority - left.priority
    || left.name.localeCompare(right.name)
    || left.filePath.localeCompare(right.filePath)
  );
}

export function selectHookifyRule(rules: readonly HookifyRule[]): HookifyRule | undefined {
  return [...rules].sort(compareHookifyRules)[0];
}
