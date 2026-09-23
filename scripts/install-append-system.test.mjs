import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installAppendSystem } from "./install-append-system.mjs";

const source = "# policy\nrule\n";

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-my-pi-append-install-"));
  const sourcePath = path.join(root, "source.md");
  const target = path.join(root, ".pi", "agent", "APPEND_SYSTEM.md");
  fs.writeFileSync(sourcePath, source);
  try {
    run({ root, sourcePath, target });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("installs the managed policy with private permissions and updates idempotently", () => fixture(({ sourcePath, target }) => {
  assert.equal(installAppendSystem({ sourcePath, target }), "installed");
  const first = fs.readFileSync(target, "utf8");
  assert.match(first, /oh-my-pi:managed-append-system:start/);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);

  assert.equal(installAppendSystem({ sourcePath, target }), "updated");
  assert.equal(fs.readFileSync(target, "utf8"), first);
}));

test("updates only the managed block while preserving surrounding user content", () => fixture(({ sourcePath, target }) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "user-before\n<!-- oh-my-pi:managed-append-system:start -->\nold\n<!-- oh-my-pi:managed-append-system:end -->\nuser-after\n", { mode: 0o640 });
  fs.writeFileSync(sourcePath, "# new policy\n");

  assert.equal(installAppendSystem({ sourcePath, target }), "updated");
  const content = fs.readFileSync(target, "utf8");
  assert.match(content, /^user-before/m);
  assert.match(content, /# new policy/);
  assert.match(content, /user-after/);
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
}));

test("preserves a non-managed user file and reports conflict", () => fixture(({ sourcePath, target }) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "user policy\n");
  let warning = "";
  assert.equal(installAppendSystem({ sourcePath, target, warn: (value) => { warning = value; } }), "conflict");
  assert.equal(fs.readFileSync(target, "utf8"), "user policy\n");
  assert.match(warning, /conflict/);
}));

test("fails closed on malformed managed markers", () => fixture(({ sourcePath, target }) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "<!-- oh-my-pi:managed-append-system:start -->\ntruncated\n");
  assert.equal(installAppendSystem({ sourcePath, target, warn: () => {} }), "conflict");
  assert.match(fs.readFileSync(target, "utf8"), /truncated/);
}));
