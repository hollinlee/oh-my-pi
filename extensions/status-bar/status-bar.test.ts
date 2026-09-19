import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderClaudeFooter, type ClaudeFooterView } from "../status-bar.ts";

const view: ClaudeFooterView = {
  model: "Claude Sonnet 4.6",
  thinking: "high",
  cwd: "~/orca/workspaces/oh-my-pi/status-bar-design",
  branch: "feat/191-claude-footer",
  contextPercent: 42,
  subagentsEnabled: true,
  tokens: { input: 12_400, cacheRead: 20_000, cacheWrite: 1_000, output: 1_800 },
};

const plainTheme = { fg: (_name: string, text: string) => text };
const rgbTheme = {
  rgb: (_hex: string, text: string) => `\u001b[38;2;217;119;87m${text}\u001b[0m`,
  fg: (_name: string, text: string) => `\u001b[2m${text}\u001b[0m`,
};

test("Claude footer is always two width-bounded unframed lines", () => {
  for (const width of [40, 80, 120]) {
    const lines = renderClaudeFooter(view, plainTheme, width);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    assert.ok(lines.every((line) => !/[┃│]/.test(line)));
  }
});

test("wide footer shows the complete environment hierarchy", () => {
  const [environment, tokens] = renderClaudeFooter(view, plainTheme, 120);
  assert.match(environment ?? "", /Claude Sonnet 4\.6/);
  assert.match(environment ?? "", /high/);
  assert.match(environment ?? "", /status-bar-design/);
  assert.match(environment ?? "", /feat\/191-claude-footer/);
  assert.match(environment ?? "", /Context \[████░░░░░░\] 42%/);
  assert.match(tokens ?? "", /Subagents ON/);
  assert.match(tokens ?? "", /in 12k/);
  assert.match(tokens ?? "", /out 1\.8k/);
  assert.match(tokens ?? "", /cache 60%/);
});

test("responsive footer drops branch, thinking, then cache detail", () => {
  const medium = renderClaudeFooter(view, plainTheme, 80).join("\n");
  assert.doesNotMatch(medium, /feat\/191/);
  assert.doesNotMatch(medium, /high/);
  assert.match(medium, /cache 60%/);

  const narrow = renderClaudeFooter(view, plainTheme, 40).join("\n");
  assert.doesNotMatch(narrow, /cache/);
  assert.match(narrow, /Subagents ON/);
  assert.match(narrow, /status/);
  assert.match(narrow, /ctx \[/);
});

test("footer is readable with rgb and semantic theme fallbacks", () => {
  for (const theme of [plainTheme, rgbTheme, {}]) {
    const lines = renderClaudeFooter(view, theme, 80);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  }
});

test("footer reports subagent capability off and unknown context", () => {
  const lines = renderClaudeFooter({ ...view, subagentsEnabled: false, contextPercent: undefined }, plainTheme, 80).join("\n");
  assert.match(lines, /Subagents OFF/);
  assert.match(lines, /--/);
});
