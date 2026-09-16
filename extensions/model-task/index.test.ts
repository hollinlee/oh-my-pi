import assert from "node:assert/strict";
import test from "node:test";
import modelTaskExtension, { isModelTaskEnabled, renderTaskPanel } from "./index.ts";
import type { TaskProgressSnapshot } from "./observability.ts";

test("model task capability is default-off and registers an opt-in tool", () => {
  assert.equal(isModelTaskEnabled({}), false);
  assert.equal(isModelTaskEnabled({ OH_MY_PI_MODEL_TASK_ENABLED: "1" }), true);
  const tools: any[] = [];
  const listeners = new Map<string, Function>();
  const commands: any[] = [];
  modelTaskExtension({
    registerTool(tool: any) { tools.push(tool); },
    registerCommand(name: string, command: any) { commands.push({ name, command }); },
    on(name: string, listener: Function) { listeners.set(name, listener); },
    events: { emit() {} },
  } as any);
  assert.equal(tools.length, process.env.OH_MY_PI_MODEL_TASK_ENABLED === "1" ? 1 : 0);

  const original = process.env.OH_MY_PI_MODEL_TASK_ENABLED;
  process.env.OH_MY_PI_MODEL_TASK_ENABLED = "1";
  try {
    tools.length = 0;
    modelTaskExtension({
      registerTool(tool: any) { tools.push(tool); },
      registerCommand(name: string, command: any) { commands.push({ name, command }); },
      on(name: string, listener: Function) { listeners.set(name, listener); },
      events: { emit() {} },
    } as any);
    assert.equal(tools[0]?.name, "model_task_run");
    assert.equal(tools[1]?.name, "model_task_remote_experiment");
    assert.equal(commands[0]?.name, "model-task");
    assert.equal(listeners.has("session_shutdown"), true);
  } finally {
    if (original === undefined) delete process.env.OH_MY_PI_MODEL_TASK_ENABLED;
    else process.env.OH_MY_PI_MODEL_TASK_ENABLED = original;
  }
});

test("task panel renders compact and expanded observability without transcript content", () => {
  const snapshot: TaskProgressSnapshot = {
    taskId: "ui-1",
    goal: "test UI",
    phase: "verification",
    status: "running",
    elapsedMs: 90_000,
    risk: true,
    model: { provider: "local", name: "coder", role: "execution", source: "task" },
    recentEvents: [{ id: "1", at: "2026-01-01T00:00:00.000Z", kind: "verification", summary: "Tests passed" }],
    commandSummaries: ["npm test"],
    verification: [{ command: "npm test", outcome: "pass", logPath: "/tmp/test.log" }],
    logs: ["/tmp/test.log"],
  };
  const compact = renderTaskPanel(snapshot);
  assert.equal(compact.length, 3);
  assert.match(compact.join("\n"), /local\/coder · execution · task/);
  const expanded = renderTaskPanel(snapshot, true).join("\n");
  assert.match(expanded, /EVENTS/);
  assert.match(expanded, /COMMANDS/);
  assert.match(expanded, /VERIFICATION/);
  assert.equal(expanded.includes("transcript"), false);
});
