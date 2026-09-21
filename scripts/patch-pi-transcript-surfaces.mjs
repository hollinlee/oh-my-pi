import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSISTANT_RELATIVE = path.join("dist", "modes", "interactive", "components", "assistant-message.js");
const TOOL_RELATIVE = path.join("dist", "modes", "interactive", "components", "tool-execution.js");
const BUNDLE_DIR = path.join("dist", "bundle", "chunks");
const BACKUP_SUFFIX = ".oh-my-pi-transcript.bak";
const METADATA_SUFFIX = ".oh-my-pi-transcript.json";

const ASSISTANT_MARKER = "OH_MY_PI_PHASE_TRACE_HIDE_ASSISTANT";
const ASSISTANT_OLD = 'if (content.type === "text") return Boolean(stripEmptyHtmlComments(content.text).trim());';
const ASSISTANT_NEW = `if (content.type === "text") return process.env.OH_MY_PI_PHASE_TRACE_DISABLED === "1" && Boolean(stripEmptyHtmlComments(content.text).trim()); /* ${ASSISTANT_MARKER} */`;
const TERMINAL_MARKER = "OH_MY_PI_PHASE_TRACE_HIDE_TERMINAL";
const TERMINAL_OLD = `        this.hasToolCalls = hasToolCalls;
        if (message.stopReason === "length") {`;
const TERMINAL_NEW = `        this.hasToolCalls = hasToolCalls;
        if (process.env.OH_MY_PI_PHASE_TRACE_DISABLED !== "1") return; /* ${TERMINAL_MARKER} */
        if (message.stopReason === "length") {`;
const TOOL_MARKER = "OH_MY_PI_PHASE_TRACE_HIDE_TOOL";
const TOOL_OLD = `    render(width) {
        if (this.hideComponent) {`;
const TOOL_NEW = `    render(width) {
        if (process.env.OH_MY_PI_PHASE_TRACE_DISABLED !== "1") return []; /* ${TOOL_MARKER} */
        if (this.hideComponent) {`;
const BUNDLE_ASSISTANT_MARKER = "OH_MY_PI_PHASE_TRACE_BUNDLE_HIDE_ASSISTANT";
const BUNDLE_ASSISTANT_OLD = 'message.content.some(c2=>c2.type==="text"&&c2.text.trim())';
const BUNDLE_ASSISTANT_NEW = `message.content.some(c2=>/*${BUNDLE_ASSISTANT_MARKER}*/process.env.OH_MY_PI_PHASE_TRACE_DISABLED==="1"&&c2.type==="text"&&c2.text.trim())`;
const BUNDLE_TERMINAL_MARKER = "OH_MY_PI_PHASE_TRACE_BUNDLE_HIDE_TERMINAL";
const BUNDLE_TERMINAL_OLD = 'this.hasToolCalls=hasToolCalls,message.stopReason==="length"';
const BUNDLE_TERMINAL_NEW = `this.hasToolCalls=hasToolCalls,/*${BUNDLE_TERMINAL_MARKER}*/process.env.OH_MY_PI_PHASE_TRACE_DISABLED==="1"&&message.stopReason==="length"`;
const BUNDLE_ERROR_OLD = 'else if(!hasToolCalls){if(message.stopReason==="aborted")';
const BUNDLE_ERROR_NEW = 'else if(process.env.OH_MY_PI_PHASE_TRACE_DISABLED==="1"&&!hasToolCalls){if(message.stopReason==="aborted")';
const BUNDLE_TOOL_MARKER = "OH_MY_PI_PHASE_TRACE_BUNDLE_HIDE_TOOL";
const BUNDLE_TOOL_OLD = "render(width){if(this.hideComponent)return[];";
const BUNDLE_TOOL_NEW = `render(width){if(/*${BUNDLE_TOOL_MARKER}*/process.env.OH_MY_PI_PHASE_TRACE_DISABLED!=="1")return[];if(this.hideComponent)return[];`;

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function findPackageRoot(start) {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    const packageJson = path.join(current, "package.json");
    if (fs.existsSync(packageJson)) {
      try {
        if (JSON.parse(fs.readFileSync(packageJson, "utf8")).name === "@earendil-works/pi-coding-agent") return current;
      } catch {}
    }
    current = path.dirname(current);
  }
  return undefined;
}

function piExecutable() {
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  let npmFallback;
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `pi${extension}`);
      if (!fs.existsSync(candidate)) continue;
      const resolved = fs.realpathSync(candidate);
      if (directory.includes(`${path.sep}node_modules${path.sep}.bin`)) npmFallback ??= resolved;
      else return resolved;
    }
  }
  return npmFallback;
}

function packageRoot() {
  if (process.env.OH_MY_PI_CODING_AGENT_ROOT) return path.resolve(process.env.OH_MY_PI_CODING_AGENT_ROOT);
  const executable = piExecutable();
  const active = executable ? findPackageRoot(path.dirname(executable)) : undefined;
  if (active) return active;
  const dependency = findPackageRoot(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  if (dependency) return dependency;
  throw new Error("Unable to locate the active @earendil-works/pi-coding-agent package root.");
}

function findBundle(root) {
  const directory = path.join(root, BUNDLE_DIR);
  const matches = fs.readdirSync(directory).filter((name) => name.endsWith(".js")).filter((name) => {
    const source = fs.readFileSync(path.join(directory, name), "utf8");
    return (source.includes(BUNDLE_ASSISTANT_OLD) && source.includes(BUNDLE_TOOL_OLD))
      || (source.includes(BUNDLE_ASSISTANT_MARKER) && source.includes(BUNDLE_TOOL_MARKER));
  });
  if (matches.length !== 1) throw new Error(`Expected one active Pi transcript bundle under ${directory}; found ${matches.length}.`);
  return path.join(directory, matches[0]);
}

function classify(source, replacements) {
  const applied = replacements.every(({ marker, oldText, newText }) => source.includes(marker) && source.includes(newText) && !source.includes(oldText));
  if (applied) return "applied";
  const compatible = replacements.every(({ marker, oldText }) => !source.includes(marker) && source.includes(oldText));
  return compatible ? "compatible" : "mismatch";
}

function targets() {
  const root = packageRoot();
  const files = [
    {
      label: "assistant transcript",
      file: path.join(root, ASSISTANT_RELATIVE),
      replacements: [
        { marker: ASSISTANT_MARKER, oldText: ASSISTANT_OLD, newText: ASSISTANT_NEW },
        { marker: TERMINAL_MARKER, oldText: TERMINAL_OLD, newText: TERMINAL_NEW },
      ],
    },
    {
      label: "tool transcript",
      file: path.join(root, TOOL_RELATIVE),
      replacements: [{ marker: TOOL_MARKER, oldText: TOOL_OLD, newText: TOOL_NEW }],
    },
    {
      label: "bundled transcript",
      file: findBundle(root),
      replacements: [
        { marker: BUNDLE_ASSISTANT_MARKER, oldText: BUNDLE_ASSISTANT_OLD, newText: BUNDLE_ASSISTANT_NEW },
        { marker: BUNDLE_TERMINAL_MARKER, oldText: BUNDLE_TERMINAL_OLD, newText: BUNDLE_TERMINAL_NEW },
        { marker: BUNDLE_TOOL_MARKER, oldText: BUNDLE_TOOL_OLD, newText: BUNDLE_TOOL_NEW },
        { marker: BUNDLE_TERMINAL_MARKER, oldText: BUNDLE_ERROR_OLD, newText: BUNDLE_ERROR_NEW },
      ],
    },
  ];
  return { root, files, version: String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? "unknown") };
}

function readTargets() {
  const resolved = targets();
  return {
    ...resolved,
    files: resolved.files.map((target) => {
      const source = fs.readFileSync(target.file, "utf8");
      return {
        ...target,
        source,
        state: classify(source, target.replacements),
        backup: `${target.file}${BACKUP_SUFFIX}`,
        metadata: `${target.file}${METADATA_SUFFIX}`,
      };
    }),
  };
}

function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
}

function patched(target) {
  if (target.state !== "compatible") throw new Error(`${target.label} source markers do not match.`);
  return target.replacements.reduce((source, replacement) => source.replace(replacement.oldText, replacement.newText), target.source);
}

function status() {
  const current = readTargets();
  console.log(`Pi version: ${current.version}`);
  for (const target of current.files) console.log(`${target.label}: ${target.state}\n  ${target.file}`);
  if (current.files.some((target) => target.state === "compatible")) console.log("Run with apply to install transcript surface suppression.");
  if (current.files.some((target) => target.state === "mismatch")) console.log("Source markers do not match; no changes will be made.");
}

function cleanupCompletedRestore(target) {
  const hasBackup = fs.existsSync(target.backup);
  const hasMetadata = fs.existsSync(target.metadata);
  if (!hasBackup && !hasMetadata) return;
  if (hasBackup !== hasMetadata) throw new Error(`Refusing to patch: ${target.label} backup and metadata must be present together.`);
  const metadata = JSON.parse(fs.readFileSync(target.metadata, "utf8"));
  const backupContent = fs.readFileSync(target.backup, "utf8");
  if (metadata.target !== target.file
    || sha256(backupContent) !== metadata.originalSha256
    || sha256(target.source) !== metadata.originalSha256) {
    throw new Error(`Refusing to patch: ${target.label} artifacts do not describe the compatible source.`);
  }
  fs.unlinkSync(target.backup);
  fs.unlinkSync(target.metadata);
}

function apply() {
  const current = readTargets();
  if (current.files.some((target) => target.state === "mismatch")) throw new Error("Refusing to patch: Pi transcript source markers do not match.");
  for (const target of current.files.filter((item) => item.state === "compatible")) {
    cleanupCompletedRestore(target);
    const output = patched(target);
    const mode = fs.statSync(target.file).mode;
    fs.copyFileSync(target.file, target.backup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(target.metadata, `${JSON.stringify({ packageVersion: current.version, target: target.file, originalSha256: sha256(target.source), patchedSha256: sha256(output), appliedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    atomicWrite(target.file, output, mode);
    console.log(`Applied ${target.label} patch: ${target.file}`);
  }
  if (current.files.every((target) => target.state === "applied")) console.log("Transcript surface patches already applied.");
}

function restore() {
  const current = readTargets();
  const records = current.files.map((target) => {
    const hasBackup = fs.existsSync(target.backup);
    const hasMetadata = fs.existsSync(target.metadata);
    if (hasBackup !== hasMetadata) throw new Error(`Cannot restore: ${target.label} backup and metadata must be present together.`);
    if (!hasBackup) return undefined;
    const metadata = JSON.parse(fs.readFileSync(target.metadata, "utf8"));
    const backupContent = fs.readFileSync(target.backup, "utf8");
    if (metadata.target !== target.file) throw new Error(`Refusing to restore: ${target.label} target mismatch.`);
    if (sha256(backupContent) !== metadata.originalSha256) throw new Error(`Refusing to restore: ${target.label} backup checksum mismatch.`);
    if (sha256(target.source) !== metadata.patchedSha256) throw new Error(`Refusing to restore: current ${target.label} changed after patching.`);
    return { ...target, backupContent, mode: fs.statSync(target.file).mode };
  }).filter(Boolean);
  if (records.length === 0) throw new Error("Cannot restore: transcript patch backups and metadata are required.");
  for (const record of records) atomicWrite(record.file, record.backupContent, record.mode);
  for (const record of records) {
    fs.unlinkSync(record.backup);
    fs.unlinkSync(record.metadata);
    console.log(`Restored original ${record.label}: ${record.file}`);
  }
}

const action = String(process.argv[2] ?? "status").trim().toLowerCase();
try {
  if (action === "status") status();
  else if (action === "apply") apply();
  else if (action === "restore") restore();
  else throw new Error("Usage: node scripts/patch-pi-transcript-surfaces.mjs [status|apply|restore]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
