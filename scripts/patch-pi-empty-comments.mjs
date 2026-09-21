import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PATCH_MARKER = "function stripEmptyHtmlComments";
const TARGET_RELATIVE_PATH = path.join("dist", "modes", "interactive", "components", "assistant-message.js");
const BUNDLE_RELATIVE_DIR = path.join("dist", "bundle", "chunks");
const BACKUP_SUFFIX = ".oh-my-pi-empty-comments.bak";
const METADATA_SUFFIX = ".oh-my-pi-empty-comments.json";

const FUNCTION_INSERT_ANCHOR = 'const OSC133_ZONE_FINAL = "\\x1b]133;C\\x07";\n';
const FUNCTION_INSERT = [
  "const PHASE_TRACE_HIDE_THINKING = process.env.OH_MY_PI_PHASE_TRACE_DISABLED !== \"1\";",
  "",
  "function stripEmptyHtmlComments(text) {",
  "    const lines = text.match(/[^\\n]*(?:\\n|$)/g) ?? [];",
  "    let output = \"\";",
  "    let plain = \"\";",
  "    let fenceChar;",
  "    let fenceLength = 0;",
  "    const flushPlain = () => {",
  "        output += plain.replace(/<!--([\\s\\S]*?)-->/g, (match, body) => body.trim() ? match : \"\");",
  "        plain = \"\";",
  "    };",
  "    for (const line of lines) {",
  "        const marker = /^[ \\t]*(`{3,}|~{3,})/.exec(line)?.[1];",
  "        if (!fenceChar) {",
  "            if (!marker) {",
  "                plain += line;",
  "                continue;",
  "            }",
  "            flushPlain();",
  "            output += line;",
  "            fenceChar = marker[0];",
  "            fenceLength = marker.length;",
  "            continue;",
  "        }",
  "        output += line;",
  "        const closingFence = new RegExp(\"^[ \\\\t]*\" + fenceChar + \"{\" + fenceLength + \",}[ \\\\t]*(?:\\\\r?\\\\n)?$\");",
  "        if (closingFence.test(line)) {",
  "            fenceChar = undefined;",
  "            fenceLength = 0;",
  "        }",
  "    }",
  "    flushPlain();",
  "    return output;",
  "}",
  "function hasRenderableContent(content) {",
  "    if (content.type === \"text\") return Boolean(stripEmptyHtmlComments(content.text).trim());",
  "    if (content.type === \"thinking\") return !PHASE_TRACE_HIDE_THINKING && Boolean(content.thinking.trim());",
  "    return false;",
  "}",
  "",
].join("\n");
const OLD_VISIBLE_CONTENT = '        const hasVisibleContent = message.content.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));';
const NEW_VISIBLE_CONTENT = "        const hasVisibleContent = message.content.some(hasRenderableContent);";
const OLD_TEXT_RENDER = `            if (content.type === "text" && content.text.trim()) {
                // Assistant text messages with no background - trim the text
                // Set paddingY=0 to avoid extra spacing before tool executions
                this.contentContainer.addChild(new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
                    transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
                }));
            }`;
const NEW_TEXT_RENDER = `            if (content.type === "text") {
                const renderableText = stripEmptyHtmlComments(content.text).trim();
                if (!renderableText) continue;
                // Assistant text messages with no background - trim the text
                // Set paddingY=0 to avoid extra spacing before tool executions
                this.contentContainer.addChild(new Markdown(renderableText, this.outputPad, 0, this.markdownTheme, undefined, {
                    transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
                }));
            }`;
const OLD_VISIBLE_AFTER = `                const hasVisibleContentAfter = message.content
                    .slice(i + 1)
                    .some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));`;
const NEW_VISIBLE_AFTER = `                const hasVisibleContentAfter = message.content
                    .slice(i + 1)
                    .some(hasRenderableContent);`;
const OLD_HIDDEN_THINKING = "                const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;";
const NEW_HIDDEN_THINKING = "                if (PHASE_TRACE_HIDE_THINKING) continue;\n                const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;";
const BUNDLE_PATCH_MARKER = "OH_MY_PI_PHASE_TRACE_BUNDLE_HIDE_THINKING";
const BUNDLE_OLD_VISIBLE_CONTENT = 'message.content.some(c2=>c2.type==="text"&&c2.text.trim()||c2.type==="thinking"&&c2.thinking.trim())';
const BUNDLE_NEW_VISIBLE_CONTENT = 'message.content.some(c2=>c2.type==="text"&&c2.text.trim())';
const BUNDLE_OLD_THINKING_GATE = 'if(i--,thinkingBlocks.length===0)continue;';
const BUNDLE_NEW_THINKING_GATE = `if(i--,thinkingBlocks.length===0)continue;/*${BUNDLE_PATCH_MARKER}*/if(process.env.OH_MY_PI_PHASE_TRACE_DISABLED!=="1")continue;`;

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
  let npmLocalFallback;
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `pi${extension}`);
      if (!fs.existsSync(candidate)) continue;
      const resolved = fs.realpathSync(candidate);
      if (directory.includes(`${path.sep}node_modules${path.sep}.bin`)) npmLocalFallback ??= resolved;
      else return resolved;
    }
  }
  return npmLocalFallback;
}

function packageRoot() {
  if (process.env.OH_MY_PI_CODING_AGENT_ROOT) return path.resolve(process.env.OH_MY_PI_CODING_AGENT_ROOT);
  const executable = piExecutable();
  const activeRoot = executable ? findPackageRoot(path.dirname(executable)) : undefined;
  if (activeRoot) return activeRoot;
  const resolvedRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  if (resolvedRoot) return resolvedRoot;
  throw new Error("Unable to locate the active @earendil-works/pi-coding-agent package root.");
}

function bundlePath(root) {
  const directory = path.join(root, BUNDLE_RELATIVE_DIR);
  const candidates = fs.readdirSync(directory).filter((name) => name.endsWith(".js"));
  for (const name of candidates) {
    const file = path.join(directory, name);
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(BUNDLE_OLD_VISIBLE_CONTENT) && source.includes(BUNDLE_OLD_THINKING_GATE) || source.includes(BUNDLE_PATCH_MARKER)) return file;
  }
  throw new Error(`Pi bundled assistant renderer not found under ${directory}`);
}

function paths() {
  const root = packageRoot();
  const target = path.join(root, TARGET_RELATIVE_PATH);
  const bundle = bundlePath(root);
  return {
    root,
    target,
    backup: `${target}${BACKUP_SUFFIX}`,
    metadata: `${target}${METADATA_SUFFIX}`,
    bundle,
    bundleBackup: `${bundle}${BACKUP_SUFFIX}`,
    bundleMetadata: `${bundle}${METADATA_SUFFIX}`,
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
  const markerCount = [PATCH_MARKER, "function hasRenderableContent", "PHASE_TRACE_HIDE_THINKING"].filter((marker) => source.includes(marker)).length;
  if (markerCount === 3) return "applied";
  if (markerCount > 0) return "mismatch";
  const anchors = [FUNCTION_INSERT_ANCHOR, OLD_VISIBLE_CONTENT, OLD_TEXT_RENDER, OLD_VISIBLE_AFTER, OLD_HIDDEN_THINKING];
  return anchors.every((anchor) => source.includes(anchor)) ? "compatible" : "mismatch";
}

function patchedSource(source) {
  if (classify(source) !== "compatible") throw new Error("Pi assistant renderer does not match the supported source markers.");
  return source
    .replace(FUNCTION_INSERT_ANCHOR, FUNCTION_INSERT_ANCHOR + FUNCTION_INSERT)
    .replace(OLD_VISIBLE_CONTENT, NEW_VISIBLE_CONTENT)
    .replace(OLD_TEXT_RENDER, NEW_TEXT_RENDER)
    .replace(OLD_VISIBLE_AFTER, NEW_VISIBLE_AFTER)
    .replace(OLD_HIDDEN_THINKING, NEW_HIDDEN_THINKING);
}

function classifyBundle(source) {
  const hasMarker = source.includes(BUNDLE_PATCH_MARKER);
  const hasLegacy = source.includes(BUNDLE_OLD_VISIBLE_CONTENT) || source.includes(BUNDLE_OLD_THINKING_GATE);
  const hasPatchedGate = source.includes(BUNDLE_NEW_THINKING_GATE);
  if (hasMarker && hasPatchedGate && !source.includes(BUNDLE_OLD_VISIBLE_CONTENT)) return "applied";
  if (hasMarker || hasPatchedGate) return "mismatch";
  return hasLegacy ? "compatible" : "mismatch";
}

function patchedBundleSource(source) {
  if (classifyBundle(source) !== "compatible") throw new Error("Pi bundled assistant renderer does not match the supported source markers.");
  return source
    .replaceAll(BUNDLE_OLD_VISIBLE_CONTENT, BUNDLE_NEW_VISIBLE_CONTENT)
    .replace(BUNDLE_OLD_THINKING_GATE, BUNDLE_NEW_THINKING_GATE);
}

function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
}

function readState() {
  const resolved = paths();
  if (!fs.existsSync(resolved.target)) throw new Error(`Pi assistant renderer not found: ${resolved.target}`);
  if (!fs.existsSync(resolved.bundle)) throw new Error(`Pi bundled assistant renderer not found: ${resolved.bundle}`);
  const source = fs.readFileSync(resolved.target, "utf8");
  const bundleSource = fs.readFileSync(resolved.bundle, "utf8");
  return {
    ...resolved,
    source,
    state: classify(source),
    bundleSource,
    bundleState: classifyBundle(bundleSource),
    version: packageVersion(resolved.packageJson),
  };
}

function status() {
  const current = readState();
  console.log(`Pi version: ${current.version}`);
  console.log(`Target: ${current.target}`);
  console.log(`Empty-comment patch: ${current.state}`);
  console.log(`Bundle target: ${current.bundle}`);
  console.log(`Bundle thinking patch: ${current.bundleState}`);
  if (current.state === "compatible" || current.bundleState === "compatible") console.log("Run with apply to install the explicit compatibility patch.");
  if (current.state === "mismatch" || current.bundleState === "mismatch") console.log("Source markers do not match; no changes will be made.");
}

function assertPatchArtifactsAvailable(backup, metadata, label) {
  if (fs.existsSync(backup) || fs.existsSync(metadata)) {
    throw new Error(`Refusing to patch: ${label} backup or metadata already exists. Restore or inspect the previous patch state first.`);
  }
}

function readRestoreRecord(target, source, backupPath, metadataPath, label) {
  const hasBackup = fs.existsSync(backupPath);
  const hasMetadata = fs.existsSync(metadataPath);
  if (hasBackup !== hasMetadata) throw new Error(`Cannot restore: ${label} backup and metadata must be present together.`);
  if (!hasBackup) return undefined;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const backup = fs.readFileSync(backupPath, "utf8");
  if (metadata.target !== target) throw new Error(`Refusing to restore: ${label} metadata target mismatch.`);
  if (sha256(backup) !== metadata.originalSha256) throw new Error(`Refusing to restore: ${label} backup checksum mismatch.`);
  if (sha256(source) !== metadata.patchedSha256) throw new Error(`Refusing to restore: current ${label} changed after patching.`);
  return { target, backup, backupPath, metadataPath, mode: fs.statSync(target).mode };
}

function apply() {
  const current = readState();
  if (current.state === "mismatch" || current.bundleState === "mismatch") throw new Error("Refusing to patch: Pi source markers do not match the supported renderer.");

  if (current.state === "compatible") assertPatchArtifactsAvailable(current.backup, current.metadata, "assistant renderer");
  if (current.bundleState === "compatible") assertPatchArtifactsAvailable(current.bundleBackup, current.bundleMetadata, "bundle");

  if (current.state === "compatible") {
    const patched = patchedSource(current.source);
    const stat = fs.statSync(current.target);
    fs.copyFileSync(current.target, current.backup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(current.metadata, `${JSON.stringify({ packageVersion: current.version, target: current.target, originalSha256: sha256(current.source), patchedSha256: sha256(patched), appliedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    atomicWrite(current.target, patched, stat.mode);
    console.log(`Applied empty-comment patch: ${current.target}`);
  }

  if (current.bundleState === "compatible") {
    const patched = patchedBundleSource(current.bundleSource);
    const stat = fs.statSync(current.bundle);
    fs.copyFileSync(current.bundle, current.bundleBackup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(current.bundleMetadata, `${JSON.stringify({ packageVersion: current.version, target: current.bundle, originalSha256: sha256(current.bundleSource), patchedSha256: sha256(patched), appliedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    atomicWrite(current.bundle, patched, stat.mode);
    console.log(`Applied bundled thinking patch: ${current.bundle}`);
  }

  if (current.state === "applied" && current.bundleState === "applied") console.log("Compatibility patches already applied.");
}

function restore() {
  const current = readState();
  const records = [
    readRestoreRecord(current.target, current.source, current.backup, current.metadata, "assistant renderer"),
    readRestoreRecord(current.bundle, current.bundleSource, current.bundleBackup, current.bundleMetadata, "bundle"),
  ].filter(Boolean);
  if (records.length === 0) throw new Error("Cannot restore: backup and metadata are required.");

  for (const record of records) atomicWrite(record.target, record.backup, record.mode);
  for (const record of records) {
    fs.unlinkSync(record.backupPath);
    fs.unlinkSync(record.metadataPath);
    console.log(`Restored original Pi ${record.target === current.bundle ? "bundled " : ""}assistant renderer: ${record.target}`);
  }
}

const action = String(process.argv[2] ?? "status").trim().toLowerCase();
try {
  if (action === "status") status();
  else if (action === "apply") apply();
  else if (action === "restore") restore();
  else throw new Error("Usage: node scripts/patch-pi-empty-comments.mjs [status|apply|restore]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
