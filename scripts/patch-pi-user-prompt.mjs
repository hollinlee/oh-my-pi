import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_ID = "oh-my-pi-user-prompt-v2";
const PATCH_MARKER = "function decorateUserPromptLines2";
const BUNDLE_CHUNKS_RELATIVE_DIR = path.join("dist", "bundle", "chunks");
const BACKUP_SUFFIX = ".oh-my-pi-user-prompt.bak";
const METADATA_SUFFIX = ".oh-my-pi-user-prompt.json";
const COMPONENT_ANCHOR = "UserMessageComponent=class";
const FUNCTION_ANCHOR = "var OSC133_ZONE_START2=";
const FUNCTION_INSERT = [
  "function userPromptForPadding2(padding){",
  "let width=Math.max(0,Math.floor(padding));",
  "return width===0?\"\":width<3?\"❯ \".slice(0,width):\" ❯ \"+\" \".repeat(width-3)",
  "}",
  "function decorateUserPromptLines2(lines,padding){",
  "if(lines.length===0)return lines;",
  "let line=lines[0],match=/^((?:\\x1B\\[[0-9;]*m)*)/.exec(line),style=match?.[1]??\"\",body=line.slice(style.length),reserved=\" \".repeat(Math.max(0,Math.floor(padding)));",
  "if(reserved&&body.startsWith(reserved))lines[0]=style+userPromptForPadding2(padding)+body.slice(reserved.length);",
  "return lines",
  "}",
].join("");
const OLD_BOX = 'new Box(this.outputPad,1,content=>theme.bg("userMessageBg",content))';
const NEW_BOX = 'new Box(Math.max(this.outputPad+2,3),0,content=>theme.bg("userMessageBg",content))';
const OLD_RENDER = "render(width){let lines=super.render(width);return lines.length===0||(";
const NEW_RENDER = "render(width){let lines=decorateUserPromptLines2(super.render(width),Math.max(this.outputPad+2,3));return lines.length===0||(";

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function occurrences(source, marker) {
  if (!marker) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) !== -1) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

function hasExactlyOnce(source, markers) {
  return markers.every((marker) => occurrences(source, marker) === 1);
}

function hasNone(source, markers) {
  return markers.every((marker) => !source.includes(marker));
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

function findRuntimeTarget(root) {
  const chunksDirectory = path.join(root, BUNDLE_CHUNKS_RELATIVE_DIR);
  if (!fs.existsSync(chunksDirectory)) throw new Error(`Pi runtime bundle directory not found: ${chunksDirectory}`);
  const candidates = fs.readdirSync(chunksDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(chunksDirectory, name))
    .filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      const hasBox = source.includes(OLD_BOX) || source.includes(NEW_BOX);
      const hasRender = source.includes(OLD_RENDER) || source.includes(NEW_RENDER);
      return source.includes(COMPONENT_ANCHOR) && hasBox && hasRender;
    });
  if (candidates.length !== 1) {
    throw new Error(`Expected one active Pi user-message bundle, found ${candidates.length}.`);
  }
  return candidates[0];
}

function paths() {
  const root = packageRoot();
  const target = findRuntimeTarget(root);
  return {
    root,
    target,
    backup: `${target}${BACKUP_SUFFIX}`,
    metadata: `${target}${METADATA_SUFFIX}`,
    packageJson: path.join(root, "package.json"),
  };
}

function packageVersion(packageJson) {
  try {
    return String(JSON.parse(fs.readFileSync(packageJson, "utf8")).version ?? "unknown");
  } catch {
    return "unknown";
  }
}

function classify(source) {
  const anchors = [COMPONENT_ANCHOR, FUNCTION_ANCHOR];
  const originalMarkers = [OLD_BOX, OLD_RENDER];
  const patchedMarkers = [PATCH_MARKER, NEW_BOX, NEW_RENDER];
  if (hasExactlyOnce(source, [...anchors, ...patchedMarkers]) && hasNone(source, originalMarkers)) return "applied";
  if (hasExactlyOnce(source, [...anchors, ...originalMarkers]) && hasNone(source, patchedMarkers)) return "compatible";
  return "mismatch";
}

function patchedSource(source) {
  if (classify(source) !== "compatible") throw new Error("Pi runtime user-message renderer does not match supported bundle markers.");
  const patched = source
    .replace(FUNCTION_ANCHOR, FUNCTION_INSERT + FUNCTION_ANCHOR)
    .replace(OLD_BOX, NEW_BOX)
    .replace(OLD_RENDER, NEW_RENDER);
  if (classify(patched) !== "applied") throw new Error("Generated user-message patch failed marker validation.");
  return patched;
}

function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
}

function readState() {
  const resolved = paths();
  const source = fs.readFileSync(resolved.target, "utf8");
  return { ...resolved, source, state: classify(source), version: packageVersion(resolved.packageJson) };
}

function status() {
  const current = readState();
  console.log(`Pi version: ${current.version}`);
  console.log(`Runtime target: ${current.target}`);
  console.log(`User prompt patch: ${current.state}`);
  if (current.state === "compatible") console.log("Run with apply to install the historical user prompt decoration.");
}

function apply() {
  const current = readState();
  if (current.state === "applied") return console.log(`Already applied: ${current.target}`);
  if (current.state !== "compatible") throw new Error("Refusing to patch: Pi runtime user-message renderer markers do not match.");
  if (fs.existsSync(current.backup) || fs.existsSync(current.metadata)) throw new Error("Refusing to patch: backup or metadata already exists.");
  const patched = patchedSource(current.source);
  const stat = fs.statSync(current.target);
  fs.copyFileSync(current.target, current.backup, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(current.metadata, `${JSON.stringify({
    patchId: PATCH_ID,
    packageVersion: current.version,
    target: current.target,
    originalSha256: sha256(current.source),
    patchedSha256: sha256(patched),
    appliedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  atomicWrite(current.target, patched, stat.mode);
  console.log(`Applied user prompt patch: ${current.target}`);
}

function restore() {
  const current = readState();
  if (!fs.existsSync(current.backup) || !fs.existsSync(current.metadata)) throw new Error("Cannot restore: backup and metadata are required.");
  const metadata = JSON.parse(fs.readFileSync(current.metadata, "utf8"));
  const backup = fs.readFileSync(current.backup, "utf8");
  if (metadata.patchId !== PATCH_ID || metadata.target !== current.target) throw new Error("Refusing to restore: patch metadata does not match the active target.");
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
