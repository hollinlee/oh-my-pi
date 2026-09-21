import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  PROMPT_PADDING_X,
  PROMPT_PREFIX,
  addPromptPrefix,
  decorateEditorLines,
  fitPromptLine,
  promptForPadding,
} from "../user-prompt.ts";

test("visual prompt replaces reserved editor padding without changing line width", () => {
  assert.equal(PROMPT_PADDING_X, 3);
  assert.equal(PROMPT_PREFIX, " ❯ ");
  assert.equal(addPromptPrefix("   hello"), " ❯ hello");
  assert.equal(addPromptPrefix("   "), " ❯ ");
  assert.equal(visibleWidth(addPromptPrefix("   hello   ")), visibleWidth("   hello   "));
});

test("visual prompt does not alter lines without reserved padding", () => {
  assert.equal(addPromptPrefix("hello"), "hello");
  assert.equal(addPromptPrefix("  hello"), "  hello");
});

test("editor decorates only the first visible logical line", () => {
  assert.deepEqual(
    decorateEditorLines(["top", "   first", "   second", "bottom"]),
    ["top", " ❯ first", "   second", "bottom"],
  );
  assert.deepEqual(
    decorateEditorLines(["top", "   continuation", "bottom"], PROMPT_PADDING_X, false),
    ["top", "   continuation", "bottom"],
  );
});

test("prompt prefix preserves multiline content and authored blank lines", () => {
  const original = ["top", "   first line", "   second line", "   ", "   fourth line", "bottom"];
  const rendered = decorateEditorLines([...original]);

  assert.deepEqual(rendered, ["top", " ❯ first line", "   second line", "   ", "   fourth line", "bottom"]);
  assert.deepEqual(original, ["top", "   first line", "   second line", "   ", "   fourth line", "bottom"]);
});

test("narrow prompt variants stay inside the editor's actual padding", () => {
  assert.equal(promptForPadding(0), "");
  assert.equal(promptForPadding(1), "❯");
  assert.equal(promptForPadding(2), "❯ ");
  assert.equal(promptForPadding(3), " ❯ ");
  assert.equal(promptForPadding(5), " ❯   ");
  assert.equal(addPromptPrefix("  x", 2), "❯ x");
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
