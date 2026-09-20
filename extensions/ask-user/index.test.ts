import assert from "node:assert/strict";
import test from "node:test";
import { ChoicePrompt, formatAskUserAnswer } from "./index.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("choice prompt navigates and returns a structured choice", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("Choose a path", ["Inspect", "Implement", "Other"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "choice", optionIndex: 1, option: "Implement" }]);
});

test("choice prompt switches to custom input and supports cancellation", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("What next?", ["Continue"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("write it");
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "custom", text: "write it" }]);

  const cancelled: unknown[] = [];
  const second = new ChoicePrompt("What next?", ["Continue"], true, theme, (answer) => cancelled.push(answer));
  second.handleInput("\x1b");
  assert.deepEqual(cancelled, [{ mode: "cancelled" }]);
});

test("answer formatting preserves a readable model-facing summary", () => {
  assert.equal(formatAskUserAnswer({ mode: "choice", option: "Inspect" }), "用户选择：Inspect");
  assert.equal(formatAskUserAnswer({ mode: "custom", text: "先看测试" }), "用户自定义回答：先看测试");
  assert.equal(formatAskUserAnswer({ mode: "cancelled" }), "用户取消了当前问题。");
});
