import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  composeTurnSurfaceEntries,
  normalizeTranscriptResult,
  renderTurnResult,
  renderTurnSummary,
  renderTurnTools,
  serializableTranscriptValue,
  transcriptToolCounts,
  transcriptUpdateSignature,
  type TranscriptTool,
  type TurnToolsEntry,
} from "./phase-trace-transcript.ts";

initTheme("dark", false);

const theme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => `\u001b[48;5;0m${text}\u001b[0m`,
  bold: (text: string) => text,
};

const tools: TranscriptTool[] = [
  {
    id: "call-1",
    name: "read",
    args: { path: "README.md" },
    result: { content: [{ type: "text", text: "# Heading\n\n- item" }], details: { truncation: { truncated: false } }, isError: false },
    status: "completed",
    callSummary: "README.md",
    resultSummary: "done · 3 lines",
  },
  {
    id: "call-2",
    name: "edit",
    args: { path: "src/app.ts" },
    result: { content: [{ type: "text", text: "applied" }], details: { diff: "-old\n+new" }, isError: true },
    status: "failed",
    callSummary: "src/app.ts",
    resultSummary: "failed",
  },
  {
    id: "call-3",
    name: "image",
    args: {},
    result: { content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }], isError: false },
    status: "cancelled",
    callSummary: "preview",
  },
];

const entry: TurnToolsEntry = {
  version: 1,
  preamble: ["Checking **three** tools."],
  tools,
};

test("turn composer emits at most one ordered surface of each kind", () => {
  const full = composeTurnSurfaceEntries({
    tools,
    preamble: ["Checking tools."],
    responseText: "done",
    outcome: "Done",
    total: "2s",
    summaryText: "✻ Done in 2s",
  });
  assert.deepEqual(full.map((item) => item.customType), [
    "oh-my-pi.turn-tools",
    "oh-my-pi.turn-result",
    "oh-my-pi.turn-summary",
  ]);
  assert.equal(full[0]?.data && "tools" in full[0].data ? full[0].data.tools.length : undefined, 3);
  assert.equal(full[1]?.data && "kind" in full[1].data ? full[1].data.kind : undefined, "result");

  const partial = composeTurnSurfaceEntries({
    tools: [],
    preamble: [],
    responseText: "unfinished",
    outcome: "Cancelled",
    total: "1s",
    summaryText: "✻ Cancelled after 1s",
  });
  assert.deepEqual(partial.map((item) => item.customType), ["oh-my-pi.turn-result", "oh-my-pi.turn-summary"]);
  assert.equal(partial[0]?.data && "kind" in partial[0].data ? partial[0].data.kind : undefined, "partial");

  const summaryOnly = composeTurnSurfaceEntries({
    tools: [],
    preamble: [],
    responseText: "",
    outcome: "Failed",
    total: "1s",
    summaryText: "✻ Failed after 1s",
  });
  assert.deepEqual(summaryOnly.map((item) => item.customType), ["oh-my-pi.turn-summary"]);
});

test("tool counts keep completed, failed, and cancelled separate", () => {
  assert.deepEqual(transcriptToolCounts(tools), { completed: 1, failed: 1, cancelled: 1 });
});

test("collapsed Tools preserves source order and omits full typed details", () => {
  const rendered = renderTurnTools(entry, false, theme)?.render(80).join("\n") ?? "";
  assert.match(rendered, /Tools · 1 completed · 1 failed · 1 cancelled/);
  assert.ok(rendered.indexOf("read") < rendered.indexOf("edit"));
  assert.ok(rendered.indexOf("edit") < rendered.indexOf("image"));
  assert.match(rendered, /Checking three tools/);
  assert.doesNotMatch(rendered, /Call/);
  assert.doesNotMatch(rendered, /Heading/);
});

test("expanded Tools uses typed args, Markdown, diff, and image fallback", () => {
  const lines = renderTurnTools(entry, true, theme)?.render(72) ?? [];
  const rendered = lines.join("\n");
  assert.match(rendered, /Call/);
  assert.match(rendered, /README\.md/);
  assert.match(rendered, /Heading/);
  assert.match(rendered, /item/);
  assert.match(rendered, /old/);
  assert.match(rendered, /new/);
  assert.match(rendered, /image/i);
  assert.ok(lines.every((line) => visibleWidth(line) <= 72));
});

test("Result, Partial, and Summary have distinct surfaces without external spacer", () => {
  const backgrounds: string[] = [];
  const recordingTheme = {
    ...theme,
    bg: (name: string, text: string) => {
      backgrounds.push(name);
      return text;
    },
  };
  const result = renderTurnResult({ version: 1, kind: "result", text: "**done**" }, recordingTheme)?.render(50) ?? [];
  const partial = renderTurnResult({ version: 1, kind: "partial", text: "unfinished" }, recordingTheme)?.render(50) ?? [];
  const tools = renderTurnTools(entry, false, recordingTheme)?.render(50) ?? [];
  const summary = renderTurnSummary({ version: 1, text: "✻ Done in 2s", outcome: "Done", total: "2s" }, recordingTheme)?.render(50) ?? [];
  assert.match(result.join("\n"), /Result/);
  assert.match(partial.join("\n"), /Partial response/);
  assert.match(result.join("\n"), /\x1b\[48;2;48;48;48m/);
  assert.match(partial.join("\n"), /\x1b\[48;2;58;43;43m/);
  assert.match(tools.join("\n"), /\x1b\[48;2;38;38;38m/);
  assert.deepEqual(summary.map((line) => line.trimEnd()), [" ✻ Done in 2s"]);
  assert.notEqual(result[0], "");
  assert.notEqual(partial[0], "");
});

test("normalization removes empty details so partial and final output deduplicate", () => {
  const partial = normalizeTranscriptResult({ content: [{ type: "text", text: "same" }], details: {} }, false);
  const final = normalizeTranscriptResult({ content: [{ type: "text", text: "same" }] }, false);
  assert.equal(partial.details, undefined);
  assert.equal(transcriptUpdateSignature(partial), transcriptUpdateSignature(final));

  const withDiff = normalizeTranscriptResult({ content: [], details: { diff: "+line" } }, false);
  assert.deepEqual(withDiff.details, { diff: "+line" });
});

test("transcript payload conversion handles bigint and circular values", () => {
  const value: Record<string, unknown> = { count: 2n };
  value.self = value;
  assert.deepEqual(serializableTranscriptValue(value), { count: "2", self: "[Circular]" });
});

test("empty transcript surfaces render nothing", () => {
  assert.equal(renderTurnTools({ version: 1, preamble: [], tools: [] }, false, theme), undefined);
  assert.equal(renderTurnResult({ version: 1, kind: "result", text: "  " }, theme), undefined);
});
