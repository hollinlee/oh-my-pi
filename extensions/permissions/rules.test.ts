import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyPermissionRisk, PermissionStore, selectPermissionRule, type PermissionDescriptor } from "./rules.ts";

const descriptor: PermissionDescriptor = { tool: "bash", action: "write", target: "src/app.ts", cwd: "/repo" };

function temporaryStore(): string {
  return join(mkdtempSync(join(tmpdir(), "oh-my-pi-permissions-")), "rules.json");
}

test("classifies explicit dangerous, read-only, and unknown operations", () => {
  assert.equal(classifyPermissionRisk({ tool: "bash", action: "rm", irreversible: true }), "high");
  assert.equal(classifyPermissionRisk({ tool: "read", action: "read file" }), "low");
  assert.equal(classifyPermissionRisk({ tool: "custom", action: "transform" }), "unknown");
});

test("permission rules persist, match exact descriptors, and revoke", () => {
  const path = temporaryStore();
  try {
    const store = new PermissionStore(path);
    const rule = store.add("allow", descriptor);
    assert.equal(new PermissionStore(path).find(descriptor)?.id, rule.id);
    assert.equal(new PermissionStore(path).find({ ...descriptor, target: "src/other.ts" }), undefined);
    assert.equal(store.remove(rule.id), true);
    assert.equal(new PermissionStore(path).list().length, 0);
  } finally {
    rmSync(path.replace(/\/rules\.json$/, ""), { recursive: true, force: true });
  }
});

test("deny wins over allow, while equal-specificity conflicts require a fresh decision", () => {
  const broad = { id: "broad", effect: "allow" as const, descriptor: { tool: "bash", action: "write" }, exact: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  const narrow = { id: "narrow", effect: "allow" as const, descriptor, exact: true, createdAt: "2026-01-02", updatedAt: "2026-01-02" };
  assert.equal(selectPermissionRule([broad, narrow], descriptor)?.id, "narrow");
  const deny = { ...narrow, id: "deny", effect: "deny" as const };
  assert.equal(selectPermissionRule([broad, narrow, deny], descriptor), undefined);
  const broadDeny = { ...broad, id: "broad-deny", effect: "deny" as const };
  assert.equal(selectPermissionRule([broadDeny, narrow], descriptor)?.id, "broad-deny");
});
