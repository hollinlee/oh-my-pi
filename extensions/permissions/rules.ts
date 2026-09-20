import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type PermissionRisk = "low" | "medium" | "high" | "unknown";
export type PermissionRuleEffect = "allow" | "deny";

export interface PermissionDescriptor {
  tool: string;
  action: string;
  target?: string;
  cwd?: string;
  host?: string;
  risk?: PermissionRisk;
  impact?: string[];
  irreversible?: boolean;
}

export interface PermissionRule {
  id: string;
  effect: PermissionRuleEffect;
  descriptor: PermissionDescriptor;
  exact: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PermissionFile {
  version: 1;
  rules: PermissionRule[];
}

export function classifyPermissionRisk(descriptor: PermissionDescriptor): PermissionRisk {
  const text = `${descriptor.action} ${descriptor.target ?? ""} ${(descriptor.impact ?? []).join(" ")}`.toLowerCase();
  if (descriptor.irreversible || /delete|remove|(?:^|\s)rm\b|destroy|drop|deploy|publish|push|sudo|credential|permission|remote|system|overwrite|覆盖|删除|部署|发布|提权|权限/.test(text)) return "high";
  if (/write|edit|install|network|外部|写入|修改|安装|联网/.test(text)) return "medium";
  if (/read|list|status|inspect|query|读取|查看|查询|状态/.test(text)) return "low";
  return descriptor.risk ?? "unknown";
}

function normalize(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function fieldMatches(rule: PermissionDescriptor, actual: PermissionDescriptor, key: keyof PermissionDescriptor): boolean {
  const expected = rule[key];
  if (expected === undefined) return true;
  if (key === "impact") {
    return Array.isArray(expected) && Array.isArray(actual.impact) && expected.every((item) => actual.impact?.includes(item));
  }
  return expected === actual[key];
}

export function descriptorMatches(rule: PermissionRule, actual: PermissionDescriptor): boolean {
  if (!rule.exact) return false;
  return (Object.keys(rule.descriptor) as Array<keyof PermissionDescriptor>).every((key) => fieldMatches(rule.descriptor, actual, key));
}

function specificity(rule: PermissionRule): number {
  return Object.values(rule.descriptor).filter((value) => value !== undefined && value !== "").length;
}

export function selectPermissionRule(rules: readonly PermissionRule[], actual: PermissionDescriptor): PermissionRule | undefined {
  const matching = rules.filter((rule) => descriptorMatches(rule, actual));
  if (matching.length === 0) return undefined;
  const maxSpecificity = Math.max(...matching.map(specificity));
  const top = matching.filter((rule) => specificity(rule) === maxSpecificity);
  if (new Set(top.map((rule) => rule.effect)).size > 1) return undefined;
  const denies = matching.filter((rule) => rule.effect === "deny");
  const candidates = denies.length > 0 ? denies : matching.filter((rule) => rule.effect === "allow");
  return [...candidates].sort((a, b) => specificity(b) - specificity(a) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
}

export function ruleId(): string {
  return `permission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PermissionStore {
  readonly path: string;
  private file: PermissionFile;

  constructor(path = permissionStorePath()) {
    this.path = path;
    this.file = this.load();
  }

  list(): PermissionRule[] { return this.file.rules.map((rule) => structuredClone(rule)); }

  add(effect: PermissionRuleEffect, descriptor: PermissionDescriptor): PermissionRule {
    const now = new Date().toISOString();
    const rule: PermissionRule = { id: ruleId(), effect, descriptor: { ...descriptor }, exact: true, createdAt: now, updatedAt: now };
    this.file.rules.push(rule);
    this.save();
    return structuredClone(rule);
  }

  update(id: string, patch: Partial<Pick<PermissionRule, "effect" | "descriptor">>): PermissionRule | undefined {
    const rule = this.file.rules.find((item) => item.id === id);
    if (!rule) return undefined;
    if (patch.effect) rule.effect = patch.effect;
    if (patch.descriptor) rule.descriptor = { ...patch.descriptor };
    rule.updatedAt = new Date().toISOString();
    this.save();
    return structuredClone(rule);
  }

  remove(id: string): boolean {
    const before = this.file.rules.length;
    this.file.rules = this.file.rules.filter((rule) => rule.id !== id);
    if (this.file.rules.length === before) return false;
    this.save();
    return true;
  }

  find(descriptor: PermissionDescriptor): PermissionRule | undefined { return selectPermissionRule(this.file.rules, descriptor); }

  private load(): PermissionFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as PermissionFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.rules)) throw new Error("invalid permission store");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, rules: [] };
      throw new Error(`Unable to load permission rules: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.file, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
  }
}

export function permissionStorePath(): string {
  return process.env.OH_MY_PI_PERMISSION_STORE ?? join(homedir(), ".pi", "agent", "permissions", "rules.json");
}

export function describePermissionRule(rule: PermissionRule): string {
  const descriptor = Object.entries(rule.descriptor).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`).join(" ");
  return `${rule.id} · ${rule.effect} · ${descriptor}`;
}

export function hasPermissionStore(path = permissionStorePath()): boolean { return existsSync(path); }
