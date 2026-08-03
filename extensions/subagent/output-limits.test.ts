import assert from "node:assert/strict";
import test from "node:test";
import { contentBytes, limitTextOutput } from "./output-limits.ts";

test("text tool output is truncated with decomposition guidance", () => {
  const content = [{ type: "text", text: "x".repeat(20_000) }];
  const limited = limitTextOutput(content, 1024);
  assert.ok(limited[0].text.length < content[0].text.length);
  assert.match(limited[0].text, /delegate a smaller task/);
});

test("content byte accounting includes text and encoded images", () => {
  assert.equal(contentBytes([
    { type: "text", text: "abc" },
    { type: "image", data: "12345" },
    { type: "other", value: "ignored" },
  ]), 8);
});
