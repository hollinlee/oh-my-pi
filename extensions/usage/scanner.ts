import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectUsageEvent } from "./collector.ts";
import { UsageStore } from "./store.ts";

function sessionFiles(root: string): string[] {
  const files: string[] = [];
  function walk(path: string): void {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(child);
    }
  }
  walk(root);
  return files.sort();
}

function headerInfo(data: Buffer): { hash: string; projectPath: string } {
  const newline = data.indexOf(10);
  const header = data.subarray(0, newline < 0 ? data.length : newline).toString("utf8");
  let projectPath = "";
  try {
    const record = JSON.parse(header) as Record<string, unknown>;
    if (record.type === "session" && typeof record.cwd === "string") projectPath = record.cwd;
  } catch {
    // A malformed header does not prevent later valid records from being collected.
  }
  return { hash: createHash("sha256").update(header).digest("hex"), projectPath };
}

export function scanSessions(store: UsageStore, sessionsDir: string): { files: number; added: number } {
  let added = 0;
  const files = sessionFiles(sessionsDir);
  for (const path of files) {
    const data = readFileSync(path);
    const { hash, projectPath } = headerInfo(data);
    const previous = store.source(path);
    let offset = previous && previous.headerHash === hash && previous.offset <= data.length ? previous.offset : 0;
    const tail = data.subarray(offset);
    const finalNewline = tail.lastIndexOf(10);
    if (finalNewline < 0) continue;
    const complete = tail.subarray(0, finalNewline + 1).toString("utf8");
    for (const line of complete.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const event = collectUsageEvent(record, line, projectPath);
        if (event && store.addEvent(event)) added++;
      } catch {
        // Session writers can leave malformed records; later records remain independently useful.
      }
    }
    offset += Buffer.byteLength(complete);
    store.saveSource(path, { offset, headerHash: hash });
  }
  return { files: files.length, added };
}
