import assert from "node:assert/strict";
import test from "node:test";
import { addPromptPrefix } from "../user-prompt.ts";

test("visual prompt prefixes only the first editor line without changing content", () => {
  assert.equal(addPromptPrefix(" hello"), "❯ hello");
  assert.equal(addPromptPrefix("  second line"), "❯  second line");
  assert.equal(addPromptPrefix(""), "");
});
