import assert from "node:assert/strict";
import test from "node:test";
import { isSubagentEnabled, resolveSubagentModel } from "./index.ts";
import type { SubagentConfig } from "./config.ts";

const qwenConfig: SubagentConfig = {
  version: 1,
  enabled: true,
  defaultModel: { provider: "vllm-qwen", model: "qwen3.8-27b" },
};

test("subagent capability is disabled unless its config enables it", () => {
  assert.equal(isSubagentEnabled(undefined), false);
  assert.equal(isSubagentEnabled({ version: 1, enabled: false }), false);
  assert.equal(isSubagentEnabled(qwenConfig), true);
});

test("configured subagent model overrides the parent model and fails closed when unavailable", () => {
  const parent = { provider: "parent", id: "parent-model", name: "Parent" };
  const qwen = { provider: "vllm-qwen", id: "qwen3.8-27b", name: "Qwen" };
  const ctx = {
    model: parent,
    modelRegistry: { find: (provider: string, model: string) => provider === "vllm-qwen" && model === "qwen3.8-27b" ? qwen : undefined },
  } as any;

  assert.equal(resolveSubagentModel(ctx, { version: 1, enabled: true }).model, parent);
  assert.equal(resolveSubagentModel(ctx, qwenConfig).model, qwen);
  assert.match(resolveSubagentModel(ctx, {
    version: 1,
    enabled: true,
    defaultModel: { provider: "vllm-qwen", model: "missing" },
  }).error ?? "", /unavailable/);
});
