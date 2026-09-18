import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerHookify } from "./index.ts";

type Handler = (event: any, ctx: any) => unknown;

function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-my-pi-hookify-extension-"));
  mkdirSync(path.join(root, ".pi", "hookify"), { recursive: true });
  return root;
}

function rule(root: string, name: string, fields: Record<string, string>): string {
  const filePath = path.join(root, ".pi", "hookify", name);
  const content = `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`;
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function handler(): Handler {
  let result: Handler | undefined;
  registerHookify({
    on(name: string, value: Handler) {
      if (name === "tool_call") result = value;
    },
  } as never);
  assert.ok(result);
  return result;
}

function context(root: string, options: {
  trusted?: boolean;
  mode?: "tui" | "rpc" | "json" | "print";
  confirmed?: boolean;
  onConfirm?: () => void;
} = {}) {
  const notifications: Array<{ message: string; type?: string }> = [];
  let confirmCalls = 0;
  const value = {
    cwd: root,
    mode: options.mode ?? "tui",
    hasUI: options.mode !== "json" && options.mode !== "print",
    isProjectTrusted: () => options.trusted ?? true,
    ui: {
      notify(message: string, type?: string) { notifications.push({ message, type }); },
      async confirm() {
        confirmCalls += 1;
        options.onConfirm?.();
        return options.confirmed ?? false;
      },
    },
  };
  return { value, notifications, get confirmCalls() { return confirmCalls; } };
}

function bash(command: string) {
  return { type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command } };
}

test("only trusted projects load rules and block matching bash calls", async () => {
  const root = project();
  try {
    rule(root, "danger.md", { name: "danger", pattern: "rm[ ]+-rf", action: "block", message: "dangerous removal" });
    const blocked = context(root);
    const result = await handler()(bash("rm -rf tmp"), blocked.value);
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /dangerous removal/);

    const untrusted = context(root, { trusted: false });
    const ignored = await handler()(bash("rm -rf tmp"), untrusted.value);
    assert.equal(ignored, undefined);
    assert.equal(untrusted.notifications.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("warn notifies without changing or blocking the command, and unmatched calls continue", async () => {
  const root = project();
  try {
    rule(root, "warn.md", { name: "warn", pattern: "npm[ ]+install", action: "warn", message: "check dependencies" });
    const current = context(root);
    const event = bash("npm install");
    const result = await handler()(event, current.value);
    assert.equal(result, undefined);
    assert.equal(event.input.command, "npm install");
    assert.equal(current.notifications.length, 1);
    assert.match(current.notifications[0]?.message ?? "", /check dependencies/);

    const unmatched = await handler()(bash("npm test"), current.value);
    assert.equal(unmatched, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("confirm asks only in TUI and fails closed without waiting in non-TUI modes", async () => {
  const root = project();
  try {
    rule(root, "confirm.md", { name: "confirm", pattern: "git[ ]+push", action: "confirm", message: "review push" });

    const accepted = context(root, { confirmed: true });
    assert.equal(await handler()(bash("git push"), accepted.value), undefined);
    assert.equal(accepted.confirmCalls, 1);

    const rejected = context(root, { confirmed: false });
    const rejectedResult = await handler()(bash("git push"), rejected.value);
    assert.equal(rejectedResult?.block, true);
    assert.equal(rejected.confirmCalls, 1);

    const nonTui = context(root, { mode: "json", confirmed: true, onConfirm: () => assert.fail("non-TUI confirm must not wait for input") });
    const nonTuiResult = await handler()(bash("git push"), nonTui.value);
    assert.equal(nonTuiResult?.block, true);
    assert.equal(nonTui.confirmCalls, 0);
    assert.match(nonTuiResult?.reason ?? "", /non-TUI/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rule edits affect the next call without reloading the extension", async () => {
  const root = project();
  try {
    const filePath = rule(root, "dynamic.md", { name: "dynamic", pattern: "deploy", action: "warn" });
    const current = context(root);
    const extensionHandler = handler();
    assert.equal(await extensionHandler(bash("deploy"), current.value), undefined);
    assert.equal(current.notifications.length, 1);

    writeFileSync(filePath, "---\nname: dynamic\npattern: deploy\naction: block\n---\n", "utf8");
    const blocked = await extensionHandler(bash("deploy"), current.value);
    assert.equal(blocked?.block, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid rules are diagnosed and do not crash or create an allow path", async () => {
  const root = project();
  try {
    rule(root, "bad-regex.md", { name: "bad-regex", pattern: "[", action: "block" });
    rule(root, "bad-action.md", { name: "bad-action", pattern: "anything", action: "allow" });
    const current = context(root);
    const result = await handler()(bash("anything"), current.value);
    assert.equal(result, undefined);
    assert.equal(current.notifications.length, 2);
    assert.ok(current.notifications.every((item) => item.type === "warning"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
