import assert from "node:assert/strict";
import test from "node:test";
import { ChoicePrompt, formatAskUserAnswer } from "./index.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("choice prompt navigates and returns a structured choice", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("Choose a path", ["Inspect", "Implement"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "choice", optionIndex: 1, option: "Implement" }]);
});

test("choice prompt exposes an explicit other option for custom input", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("What next?", ["Continue"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("\x1b[B");
  assert.match(prompt.render(40).join("\n"), /❯ 其他/);
  prompt.handleInput("\r");
  assert.match(prompt.render(40).join("\n"), /Continue/);
  assert.match(prompt.render(40).join("\n"), /其他/);
  prompt.handleInput("先看测试");
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "custom", text: "先看测试" }]);
});

test("choice prompt switches to custom input directly and supports cancellation", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("What next?", ["Continue"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("write it");
  assert.match(prompt.render(40).join("\n"), /❯ Continue/);
  assert.match(prompt.render(40).join("\n"), /write it/);
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "custom", optionIndex: 0, option: "Continue", text: "write it" }]);

  const cancelled: unknown[] = [];
  const second = new ChoicePrompt("What next?", ["Continue"], true, theme, (answer) => cancelled.push(answer));
  second.handleInput("\x1b[B");
  second.handleInput("\r");
  second.handleInput("\x1b");
  assert.deepEqual(cancelled, [{ mode: "cancelled" }]);
});

test("choice prompt keeps rendered lines within narrow widths", () => {
  const prompt = new ChoicePrompt("A very long question", ["A very long option", "Another option"], true, theme, () => {});
  assert.ok(prompt.render(12).every((line) => visibleWidth(line) <= 12));
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\r");
  assert.ok(prompt.render(8).every((line) => visibleWidth(line) <= 8));
});

test("answer formatting preserves a readable model-facing summary", () => {
  assert.equal(formatAskUserAnswer({ mode: "choice", option: "Inspect" }), "用户选择：Inspect");
  assert.equal(formatAskUserAnswer({ mode: "custom", text: "先看测试" }), "用户自定义回答：先看测试");
  assert.equal(formatAskUserAnswer({ mode: "cancelled" }), "用户取消了当前问题。");
});
