import assert from "node:assert/strict";
import test from "node:test";
import { ChoicePrompt, formatAskUserAnswer, shouldEnforceAskUser } from "./index.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("enforces only high-confidence blocking choices once and only when ask_user was not called", () => {
  const choice = "请选择方案 A 还是方案 B？";
  assert.equal(shouldEnforceAskUser(choice, false, false), true);
  assert.equal(shouldEnforceAskUser(choice, true, false), false);
  assert.equal(shouldEnforceAskUser(choice, false, true), false);
  assert.equal(shouldEnforceAskUser("这是实现结果。", false, false), false);
  assert.equal(shouldEnforceAskUser("这里有两个选项：A 或 B。", false, false), false);
});

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

test("choice prompt keeps custom text when switching away and back to Other", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("What next?", ["Continue", "Stop"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\r");
  prompt.handleInput("保留这段文字");
  prompt.handleInput("\x1b[A");
  assert.match(prompt.render(40).join("\n"), /保留这段文字/);
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "custom", text: "保留这段文字" }]);
});

test("choice prompt wraps long question, options, and custom text", () => {
  const prompt = new ChoicePrompt("这是一个很长的问题，需要在窄终端中保持可读并完整换行", ["这是一个很长的选项"], true, theme, () => {});
  prompt.handleInput("\x1b[B");
  prompt.handleInput("\r");
  prompt.handleInput("这是一段很长的自定义回答");
  assert.ok(prompt.render(10).every((line) => visibleWidth(line) <= 10));
  assert.match(prompt.render(10).join(""), /自定/);
  assert.match(prompt.render(10).join(""), /义回答/);
});
test("choice prompt switches to custom input directly and supports cancellation", () => {
  const answers: unknown[] = [];
  const prompt = new ChoicePrompt("What next?", ["Continue"], true, theme, (answer) => answers.push(answer));
  prompt.handleInput("write it");
  assert.match(prompt.render(40).join("\n"), /❯ 其他：write it/);
  assert.match(prompt.render(40).join("\n"), /Continue/);
  prompt.handleInput("\r");
  assert.deepEqual(answers, [{ mode: "custom", text: "write it" }]);

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
