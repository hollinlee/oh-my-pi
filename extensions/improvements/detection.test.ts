import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerImprovementDetection, resetImprovementFacts } from "./detection.ts";
import { resetImprovementRoot } from "./store.ts";

type Listener = (event: any, ctx?: any) => unknown;

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "oh-my-pi-improvements-detection-"));
}

function extensionFixture() {
  const listeners = new Map<string, Listener>();
  let tool: any;
  registerImprovementDetection({
    on(name: string, handler: Listener) { listeners.set(name, handler); },
    registerTool(value: any) { tool = value; },
  } as never);
  return { listeners, tool };
}

function context(sessionId = "session-1") {
  return { sessionManager: { getSessionId: () => sessionId } };
}

test("records bounded deterministic tool facts without retaining arguments in the prompt", () => {
  resetImprovementFacts();
  const { listeners } = extensionFixture();
  listeners.get("tool_execution_start")?.({ toolCallId: "call-1", toolName: "remote_exec", args: { command: "secret-command" } });
  listeners.get("tool_call")?.({ toolCallId: "call-1", toolName: "remote_exec", input: { command: "secret-command" } });
  listeners.get("tool_call")?.({ toolCallId: "call-2", toolName: "remote_exec", input: { command: "secret-command" } });
  listeners.get("tool_result")?.({
    toolCallId: "call-1",
    toolName: "remote_exec",
    input: { command: "secret-command" },
    isError: true,
    details: { truncated: true },
    content: [{ type: "text", text: "failed" }],
  });
  const result = listeners.get("before_agent_start")?.({});
  assert.match(result.systemPrompt, /remote_exec/);
  assert.match(result.systemPrompt, /calls=2/);
  assert.match(result.systemPrompt, /errors=1/);
  assert.match(result.systemPrompt, /truncated=1/);
  assert.match(result.systemPrompt, /outputChars=6/);
  assert.match(result.systemPrompt, /lastStatus=error/);
  assert.match(result.systemPrompt, /lastDurationMs=\d+/);
  assert.doesNotMatch(result.systemPrompt, /secret-command/);
});

test("a one-off failure remains a signal and never writes automatically", () => {
  const root = fixture();
  const oldState = process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
  process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = root;
  try {
    const { listeners } = extensionFixture();
    listeners.get("tool_call")?.({ toolCallId: "call-1", toolName: "bash", input: { command: "false" } });
    listeners.get("tool_result")?.({ toolCallId: "call-1", toolName: "bash", input: { command: "false" }, isError: true, content: [], details: undefined });
    const result = listeners.get("before_agent_start")?.({});
    assert.match(result.systemPrompt, /do not auto-save or treat a one-off failure as friction/);
    assert.equal(requireSuggestionFiles(root), 0);
  } finally {
    if (oldState === undefined) delete process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
    else process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = oldState;
    resetImprovementRoot(root);
    resetImprovementFacts();
  }
});

test("requires confirmation, redacts saved context, and deduplicates within a session", async () => {
  const root = fixture();
  const oldState = process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
  process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = root;
  try {
    const { tool } = extensionFixture();
    const rejected = await tool.execute("call-1", { confirmed: false, goal: "should not save" }, undefined, undefined, context());
    assert.match(rejected.content[0].text, /not saved/);

    const params = {
      confirmed: true,
      goal: "读取远端配置",
      tool: "remote_exec",
      parameters: { token: "secret", host: "192.168.1.8" },
      evidence: "输出不可见",
      gap: "agent 无法读取输出",
    };
    const confirmed = await tool.execute("call-2", params, undefined, undefined, context());
    assert.match(confirmed.content[0].text, /saved/);
    const duplicate = await tool.execute("call-3", params, undefined, undefined, context());
    assert.match(duplicate.content[0].text, /already recorded/);
    assert.equal(requireSuggestionFiles(root), 1);

    const saved = JSON.parse(readFileSync(path.join(root, readdirSync(root)[0]!), "utf8"));
    assert.equal(saved.context.parameters.token, "[REDACTED]");
    assert.equal(saved.context.parameters.host, "[PRIVATE_HOST]");
    assert.equal(saved.context.sessionId, "session-1");
  } finally {
    if (oldState === undefined) delete process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
    else process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = oldState;
    resetImprovementRoot(root);
    resetImprovementFacts();
  }
});

test("task ids isolate deduplication across tasks", async () => {
  const root = fixture();
  const oldState = process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
  process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = root;
  try {
    const { tool } = extensionFixture();
    const base = { confirmed: true, goal: "same goal", tool: "read", gap: "same gap" };
    await tool.execute("call-1", { ...base, taskId: "task-a" }, undefined, undefined, context());
    await tool.execute("call-2", { ...base, taskId: "task-b" }, undefined, undefined, context());
    assert.equal(requireSuggestionFiles(root), 2);
  } finally {
    if (oldState === undefined) delete process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR;
    else process.env.OH_MY_PI_IMPROVEMENT_STATE_DIR = oldState;
    resetImprovementRoot(root);
    resetImprovementFacts();
  }
});

test("skill keeps semantic triage, editing, confirmation, and privacy boundaries explicit", () => {
  const skill = readFileSync(path.join(process.cwd(), "skills", "improvement-suggestions", "SKILL.md"), "utf8");
  assert.match(skill, /normal one-off command failure is not enough/i);
  assert.match(skill, /may edit.*or cancel/i);
  assert.match(skill, /After confirmation, call the `improvement_suggestion` tool/i);
  assert.match(skill, /Do not include full conversation history/i);
});

function requireSuggestionFiles(root: string): number {
  return readdirSync(root).filter((name) => name.endsWith(".json")).length;
}
