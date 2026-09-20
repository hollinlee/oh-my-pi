import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_MARKER = "function addUserPromptPrefix";
const TARGET_RELATIVE_PATH = path.join("dist", "modes", "interactive", "components", "user-message.js");
const BACKUP_SUFFIX = ".oh-my-pi-user-prompt.bak";
const METADATA_SUFFIX = ".oh-my-pi-user-prompt.json";
const IMPORT_ANCHOR = 'import { getMarkdownTheme, theme } from "../theme/theme.js";\n';
const FUNCTION_INSERT = [
  "function addUserPromptPrefix(line) {",
  "    const match = /^(\\x1b\\[[0-9;]*m) /.exec(line);",
  "    return match ? `${match[1]} ❯ ${line.slice(match[0].length)}` : ` ❯ ${line}`;",
  "}",
  "",
].join("\n");
const OLD_BOX = "new Box(this.outputPad, 1, (content) => theme.bg(\"userMessageBg\", content))";
const NEW_BOX = "new Box(this.outputPad, 0, (content) => theme.bg(\"userMessageBg\", content))";
const OLD_FIRST_LINE = "lines[0] = OSC133_ZONE_START + lines[0];";
const NEW_FIRST_LINE = "lines[0] = OSC133_ZONE_START + addUserPromptPrefix(lines[0]);";

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function findPackageRoot(start) {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (pkg.name === "@earendil-works/pi-coding-agent") return current;
      } catch {}
    }
    current = path.dirname(current);
  }
  return undefined;
}

function piExecutable() {
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `pi${extension}`);
      if (!fs.existsSync(candidate)) continue;
      return fs.realpathSync(candidate);
    }
  }
  return undefined;
}

function packageRoot() {
  const executable = piExecutable();
  const activeRoot = executable ? findPackageRoot(path.dirname(executable)) : undefined;
  if (activeRoot) return activeRoot;
  const resolvedRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  if (resolvedRoot) return resolvedRoot;
  throw new Error("Unable to locate the active @earendil-works/pi-coding-agent package root.");
}

function paths() {
  const root = packageRoot();
  const target = path.join(root, TARGET_RELATIVE_PATH);
  return { root, target, backup: `${target}${BACKUP_SUFFIX}`, metadata: `${target}${METADATA_SUFFIX}`, packageJson: path.join(root, "package.json") };
}

function packageVersion(packageJson) {
  try {
    return String(JSON.parse(fs.readFileSync(packageJson, "utf8")).version ?? "unknown");
  } catch {
    return "unknown";
  }
}

function classify(source) {
  if (source.includes(PATCH_MARKER)) return "applied";
  return source.includes(IMPORT_ANCHOR) && source.includes(OLD_BOX) && source.includes(OLD_FIRST_LINE) ? "compatible" : "mismatch";
}

function patchedSource(source) {
  if (classify(source) !== "compatible") throw new Error("Pi user message renderer does not match supported source markers.");
  return source
    .replace(IMPORT_ANCHOR, IMPORT_ANCHOR + FUNCTION_INSERT)
    .replace(OLD_BOX, NEW_BOX)
    .replace(OLD_FIRST_LINE, NEW_FIRST_LINE);
}

function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
}

function readState() {
  const resolved = paths();
  if (!fs.existsSync(resolved.target)) throw new Error(`Pi user message renderer not found: ${resolved.target}`);
  const source = fs.readFileSync(resolved.target, "utf8");
  return { ...resolved, source, state: classify(source), version: packageVersion(resolved.packageJson) };
}

function status() {
  const current = readState();
  console.log(`Pi version: ${current.version}`);
  console.log(`Target: ${current.target}`);
  console.log(`User prompt patch: ${current.state}`);
  if (current.state === "compatible") console.log("Run with apply to install the visual prompt and remove outer vertical padding.");
}

function apply() {
  const current = readState();
  if (current.state === "applied") return console.log(`Already applied: ${current.target}`);
  if (current.state !== "compatible") throw new Error("Refusing to patch: Pi user message source markers do not match.");
  if (fs.existsSync(current.backup) || fs.existsSync(current.metadata)) throw new Error("Refusing to patch: backup or metadata already exists.");
  const patched = patchedSource(current.source);
  const stat = fs.statSync(current.target);
  fs.copyFileSync(current.target, current.backup, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(current.metadata, `${JSON.stringify({ packageVersion: current.version, target: current.target, originalSha256: sha256(current.source), patchedSha256: sha256(patched), appliedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  atomicWrite(current.target, patched, stat.mode);
  console.log(`Applied user prompt patch: ${current.target}`);
}

function restore() {
  const current = readState();
  if (!fs.existsSync(current.backup) || !fs.existsSync(current.metadata)) throw new Error("Cannot restore: backup and metadata are required.");
  const metadata = JSON.parse(fs.readFileSync(current.metadata, "utf8"));
  const backup = fs.readFileSync(current.backup, "utf8");
  if (sha256(backup) !== metadata.originalSha256 || sha256(current.source) !== metadata.patchedSha256) throw new Error("Refusing to restore: renderer checksum changed.");
  const stat = fs.statSync(current.target);
  atomicWrite(current.target, backup, stat.mode);
  fs.unlinkSync(current.backup);
  fs.unlinkSync(current.metadata);
  console.log(`Restored original Pi user message renderer: ${current.target}`);
}

const action = String(process.argv[2] ?? "status").trim().toLowerCase();
try {
  if (action === "status") status();
  else if (action === "apply") apply();
  else if (action === "restore") restore();
  else throw new Error("Usage: node scripts/patch-pi-user-prompt.mjs [status|apply|restore]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
