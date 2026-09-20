import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSubagentConfig, readSubagentConfig, writeSubagentConfig } from "./config.ts";

test("subagent config accepts a fixed default model and rejects unknown fields", () => {
  assert.deepEqual(parseSubagentConfig({
    version: 1,
    enabled: true,
    defaultModel: { provider: "vllm-qwen", model: "qwen3.8-27b" },
  }), {
    version: 1,
    enabled: true,
    defaultModel: { provider: "vllm-qwen", model: "qwen3.8-27b" },
  });
  assert.equal(parseSubagentConfig({ version: 1, enabled: true, extra: true }), undefined);
  assert.equal(parseSubagentConfig({ version: 1, enabled: true, defaultModel: { provider: "vllm-qwen" } }), undefined);
});

test("subagent config is private, atomic, and fail-closed when malformed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-config-"));
  const file = path.join(root, "nested", "config.json");
  try {
    assert.deepEqual(readSubagentConfig(file).config, { version: 1, enabled: false });
    writeSubagentConfig({
      version: 1,
      enabled: true,
      defaultModel: { provider: "vllm-qwen", model: "qwen3.8-27b" },
    }, file);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(readSubagentConfig(file).config?.defaultModel?.model, "qwen3.8-27b");
    fs.writeFileSync(file, "not json");
    assert.match(readSubagentConfig(file).error ?? "", /Unable to read/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
