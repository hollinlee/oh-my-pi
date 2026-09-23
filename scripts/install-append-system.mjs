import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKER_START = "<!-- oh-my-pi:managed-append-system:start -->";
const MARKER_END = "<!-- oh-my-pi:managed-append-system:end -->";
const DEFAULT_TARGET = path.join(os.homedir(), ".pi", "agent", "APPEND_SYSTEM.md");
const DEFAULT_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "system", "APPEND_SYSTEM.md");

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function managedContent(content) {
  return `${MARKER_START}\n${content.trim()}\n${MARKER_END}\n`;
}

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
}

export function installAppendSystem({ sourcePath = DEFAULT_SOURCE, target = DEFAULT_TARGET, warn = console.warn, log = console.log } = {}) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const next = managedContent(source);
  if (!fs.existsSync(target)) {
    atomicWrite(target, next);
    log(`Installed oh-my-pi APPEND_SYSTEM: ${target} (${sha256(next)})`);
    return "installed";
  }
  const current = fs.readFileSync(target, "utf8");
  if (!current.includes(MARKER_START) || !current.includes(MARKER_END)) {
    warn(`Preserved user APPEND_SYSTEM; oh-my-pi managed install conflict: ${target}`);
    return "conflict";
  }
  const start = current.indexOf(MARKER_START);
  const end = current.indexOf(MARKER_END, start);
  if (end < start) {
    warn(`Preserved malformed APPEND_SYSTEM; oh-my-pi install skipped: ${target}`);
    return "conflict";
  }
  const updated = `${current.slice(0, start)}${next.trimEnd()}\n${current.slice(end + MARKER_END.length).replace(/^\n/, "")}`;
  if (updated !== current) atomicWrite(target, updated, fs.statSync(target).mode & 0o777);
  log(`Updated oh-my-pi APPEND_SYSTEM: ${target} (${sha256(next)})`);
  return "updated";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    installAppendSystem();
  } catch (error) {
    console.warn(`oh-my-pi APPEND_SYSTEM install skipped; package installation continues. ${error instanceof Error ? error.message : String(error)}`);
  }
}
