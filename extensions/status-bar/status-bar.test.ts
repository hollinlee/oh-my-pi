import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  applySubagentFooterStatus,
  clearSubagentFooterDispatch,
  renderClaudeFooter,
  type ClaudeFooterView,
  type SubagentFooterSnapshot,
} from "../status-bar.ts";

const view: ClaudeFooterView = {
  model: "Claude Sonnet 4.6",
  thinking: "high",
  cwd: "~/orca/workspaces/oh-my-pi/status-bar-design",
  branch: "feat/248-footer-contract",
  contextTokens: 80_000,
  contextWindow: 200_000,
  contextPercent: 42,
  subagentsEnabled: true,
  subagentModel: "lingsuan/luna",
  subagentActiveCount: 1,
  tokens: { input: 12_400, cacheRead: 20_000, cacheWrite: 1_000, output: 1_800 },
};

const plainTheme = { fg: (_name: string, text: string) => text };
const rgbTheme = {
  rgb: (_hex: string, text: string) => `\u001b[38;2;217;119;87m${text}\u001b[0m`,
  fg: (_name: string, text: string) => `\u001b[2m${text}\u001b[0m`,
};

test("footer is always exactly two width-bounded unframed lines", () => {
  for (const width of [40, 80, 120]) {
    const lines = renderClaudeFooter(view, plainTheme, width);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => visibleWidth(line) === width));
    assert.ok(lines.every((line) => !/[┃│]/.test(line)));
    assert.ok(lines.every((line) => line.startsWith(" ") && line.endsWith(" ")));
  }
});

test("wide footer shows the complete information contract", () => {
  const [environment, resources] = renderClaudeFooter(view, plainTheme, 120);
  assert.match(environment ?? "", /Claude Sonnet 4\.6/);
  assert.match(environment ?? "", /high/);
  assert.match(environment ?? "", /status-bar-design/);
  assert.match(environment ?? "", /feat\/248-footer-contract/);
  assert.match(environment ?? "", /Context \[████░░░░░░\] 42% · 80k \/ 200k/);
  assert.match(resources ?? "", /Subagents ON · lingsuan\/luna · active 1/);
  assert.match(resources ?? "", /Tokens in 12k/);
  assert.match(resources ?? "", /out 1\.8k/);
  assert.match(resources ?? "", /cache 60%/);
});

test("medium footer drops branch and thinking but keeps context and subagent model", () => {
  const rendered = renderClaudeFooter(view, plainTheme, 80).join("\n");
  assert.doesNotMatch(rendered, /feat\/248/);
  assert.doesNotMatch(rendered, /high/);
  assert.match(rendered, /ctx \[███░░░\] 42% · 80k\/200k/);
  assert.match(rendered, /Subagents ON · luna · 1 active/);
  assert.match(rendered, /in 12k/);
  assert.match(rendered, /out 1\.8k/);
  assert.match(rendered, /cache 60%/);
});

test("narrow footer drops cache detail but preserves high-priority values", () => {
  const rendered = renderClaudeFooter(view, plainTheme, 40).join("\n");
  assert.match(rendered, /Sonnet 4\.6/);
  assert.match(rendered, /ctx 42% 80k\/200k/);
  assert.match(rendered, /Subagents ON luna x1/);
  assert.match(rendered, /i12k\/o1\.8k/);
  assert.doesNotMatch(rendered, /cache/);
});

test("context renders unknown, zero, and full usage without stale values", () => {
  const unknown = renderClaudeFooter({
    ...view,
    contextTokens: undefined,
    contextWindow: undefined,
    contextPercent: undefined,
  }, plainTheme, 80)[0] ?? "";
  assert.match(unknown, /--% · \?\/\?/);

  const zero = renderClaudeFooter({ ...view, contextTokens: 0, contextPercent: 0 }, plainTheme, 80)[0] ?? "";
  assert.match(zero, /\[░░░░░░\] 0% · 0\/200k/);

  const full = renderClaudeFooter({ ...view, contextTokens: 200_000, contextPercent: 100 }, plainTheme, 80)[0] ?? "";
  assert.match(full, /\[██████\] 100% · 200k\/200k/);
});

test("footer reports Subagents OFF and multiple active models", () => {
  const off = renderClaudeFooter({
    ...view,
    subagentsEnabled: false,
    subagentModel: undefined,
    subagentActiveCount: 0,
  }, plainTheme, 40)[1] ?? "";
  assert.match(off, /Subagents OFF/);
  assert.match(off, /i12k\/o1\.8k/);

  const multiple = renderClaudeFooter({
    ...view,
    subagentModel: "provider/model-a + provider/model-b",
    subagentActiveCount: 3,
  }, plainTheme, 120)[1] ?? "";
  assert.match(multiple, /Subagents ON · provider\/model-a \+ provider\/model-b · active 3/);
});

test("subagent activity uses dispatch identity and clears late updates at tool end", () => {
  const snapshots = new Map<string, SubagentFooterSnapshot>();
  applySubagentFooterStatus(snapshots, { dispatchId: "call-a", taskId: "same", status: "running", model: "model-a" });
  applySubagentFooterStatus(snapshots, { dispatchId: "call-b", taskId: "same", status: "running", model: "model-b" });
  assert.equal(snapshots.size, 2);

  applySubagentFooterStatus(snapshots, { dispatchId: "call-a", taskId: "same", status: "completed", model: "model-a" });
  assert.deepEqual([...snapshots.keys()], ["call-b"]);

  applySubagentFooterStatus(snapshots, { dispatchId: "call-a", taskId: "same", status: "running", model: "model-a" });
  clearSubagentFooterDispatch(snapshots, "call-a");
  assert.deepEqual([...snapshots.keys()], ["call-b"]);

  applySubagentFooterStatus(snapshots, { dispatchId: "batch:node", status: "starting", model: "model-c" });
  clearSubagentFooterDispatch(snapshots, "batch");
  assert.deepEqual([...snapshots.keys()], ["call-b"]);
});

test("footer is readable with rgb and semantic theme fallbacks", () => {
  for (const theme of [plainTheme, rgbTheme, {}]) {
    for (const width of [40, 80, 120]) {
      const lines = renderClaudeFooter(view, theme, width);
      assert.equal(lines.length, 2);
      assert.ok(lines.every((line) => visibleWidth(line) === width));
    }
  }
});
