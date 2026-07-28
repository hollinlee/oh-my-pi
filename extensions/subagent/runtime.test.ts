import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensurePrivateTranscriptPermissions } from "./runtime.ts";

test("sidechain transcript is materialized with owner-only permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-transcript-"));
  const transcript = path.join(directory, "child.jsonl");
  try {
    fs.writeFileSync(transcript, "");
    assert.equal(ensurePrivateTranscriptPermissions(transcript), true);
    assert.equal(fs.existsSync(transcript), true);
    assert.equal(fs.statSync(transcript).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
