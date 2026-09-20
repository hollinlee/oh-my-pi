import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { addPromptPrefix, fitPromptLine } from "../user-prompt.ts";

test("visual prompt prefixes only the first editor line without changing content", () => {
  assert.equal(addPromptPrefix(" hello"), " ❯ hello");
  assert.equal(addPromptPrefix("  second line"), " ❯  second line");
  assert.equal(addPromptPrefix(""), "");
});

test("prompt prefix is clipped to the terminal width", () => {
  const width = 239;
  const line = addPromptPrefix(" ".repeat(width));
  const fitted = fitPromptLine(line, width);

  assert.equal(visibleWidth(fitted), width);
  assert.ok(visibleWidth(fitted) <= width);
});

test("prompt fitting preserves ANSI styling within the width", () => {
  const width = 12;
  const line = "\x1b[7m" + "x".repeat(width + 4) + "\x1b[0m";

  assert.equal(visibleWidth(fitPromptLine(line, width)), width);
});
