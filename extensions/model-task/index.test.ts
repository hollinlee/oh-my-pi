import assert from "node:assert/strict";
import test from "node:test";
import modelTaskExtension, { isModelTaskEnabled } from "./index.ts";

test("model task capability is default-off and registers an opt-in tool", () => {
  assert.equal(isModelTaskEnabled({}), false);
  assert.equal(isModelTaskEnabled({ OH_MY_PI_MODEL_TASK_ENABLED: "1" }), true);
  const tools: any[] = [];
  const listeners = new Map<string, Function>();
  modelTaskExtension({
    registerTool(tool: any) { tools.push(tool); },
    on(name: string, listener: Function) { listeners.set(name, listener); },
  } as any);
  assert.equal(tools.length, process.env.OH_MY_PI_MODEL_TASK_ENABLED === "1" ? 1 : 0);

  const original = process.env.OH_MY_PI_MODEL_TASK_ENABLED;
  process.env.OH_MY_PI_MODEL_TASK_ENABLED = "1";
  try {
    tools.length = 0;
    modelTaskExtension({
      registerTool(tool: any) { tools.push(tool); },
      on(name: string, listener: Function) { listeners.set(name, listener); },
    } as any);
    assert.equal(tools[0]?.name, "model_task_run");
    assert.equal(listeners.has("session_shutdown"), true);
  } finally {
    if (original === undefined) delete process.env.OH_MY_PI_MODEL_TASK_ENABLED;
    else process.env.OH_MY_PI_MODEL_TASK_ENABLED = original;
  }
});
