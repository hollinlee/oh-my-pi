import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { addPromptPrefix, fitPromptLine } from "../user-prompt.ts";

test("visual prompt prefixes only the first editor line without changing content", () => {
  assert.equal(addPromptPrefix(" hello"), " ❯ hello");
  assert.equal(addPromptPrefix("  second line"), " ❯  second line");
  assert.equal(addPromptPrefix(""), "");
});

test("prompt prefix preserves multiline user content as a visual-only first-line decoration", () => {
  const original = " first line\nsecond line\n\n fourth line";
  const rendered = addPromptPrefix(original.split("\n")[0]!) + "\n" + original.split("\n").slice(1).join("\n");
  assert.equal(rendered, " ❯ first line\nsecond line\n\n fourth line");
  assert.equal(original, " first line\nsecond line\n\n fourth line");
});
test("prompt prefix is clipped to the terminal width", () => {
  const width = 239;
  const line = addPromptPrefix(" ".repeat(width));
  const fitted = fitPromptLine(line, width);

  assert.equal(visibleWidth(fitted), width);
  assert.ok(visibleWidth(fitted) <= width);
});

test("prompt fitting handles zero and narrow widths without overflow", () => {
  assert.equal(fitPromptLine(" ❯ text", 0), "");
  const fitted = fitPromptLine(" ❯ text", 4);
  assert.equal(visibleWidth(fitted), 4);
});

test("prompt fitting preserves ANSI styling within the width", () => {
  const width = 12;
  const line = "\x1b[7m" + "x".repeat(width + 4) + "\x1b[0m";

  assert.equal(visibleWidth(fitPromptLine(line, width)), width);
});
