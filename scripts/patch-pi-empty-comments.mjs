import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PATCH_MARKER = "function stripEmptyHtmlComments";
const TARGET_RELATIVE_PATH = path.join("dist", "modes", "interactive", "components", "assistant-message.js");
const BACKUP_SUFFIX = ".oh-my-pi-empty-comments.bak";
const METADATA_SUFFIX = ".oh-my-pi-empty-comments.json";

const FUNCTION_INSERT_ANCHOR = 'const OSC133_ZONE_FINAL = "\\x1b]133;C\\x07";\n';
const FUNCTION_INSERT = [
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
  "    if (content.type === \"thinking\") return Boolean(content.thinking.trim());",
  "    return false;",
  "}",
  "",
].join("\n");
const OLD_VISIBLE_CONTENT = '        const hasVisibleContent = message.content.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));';
const NEW_VISIBLE_CONTENT = "        const hasVisibleContent = message.content.some(hasRenderableContent);";
const OLD_TEXT_RENDER = `            if (content.type === "text" && content.text.trim()) {
                // Assistant text messages with no background - trim the text
                // Set paddingY=0 to avoid extra spacing before tool executions
                this.contentContainer.addChild(new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme));
            }`;
const NEW_TEXT_RENDER = `            if (content.type === "text") {
                const renderableText = stripEmptyHtmlComments(content.text).trim();
                if (!renderableText) continue;
                // Assistant text messages with no background - trim the text
                // Set paddingY=0 to avoid extra spacing before tool executions
                this.contentContainer.addChild(new Markdown(renderableText, this.outputPad, 0, this.markdownTheme));
            }`;
const OLD_VISIBLE_AFTER = `                const hasVisibleContentAfter = message.content
                    .slice(i + 1)
                    .some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));`;
const NEW_VISIBLE_AFTER = `                const hasVisibleContentAfter = message.content
                    .slice(i + 1)
                    .some(hasRenderableContent);`;

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

function paths() {
  const root = packageRoot();
  const target = path.join(root, TARGET_RELATIVE_PATH);
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
  if (source.includes(PATCH_MARKER)) return "applied";
  const anchors = [FUNCTION_INSERT_ANCHOR, OLD_VISIBLE_CONTENT, OLD_TEXT_RENDER, OLD_VISIBLE_AFTER];
  return anchors.every((anchor) => source.includes(anchor)) ? "compatible" : "mismatch";
}

function patchedSource(source) {
  if (classify(source) !== "compatible") throw new Error("Pi assistant renderer does not match the supported source markers.");
  return source
    .replace(FUNCTION_INSERT_ANCHOR, FUNCTION_INSERT_ANCHOR + FUNCTION_INSERT)
    .replace(OLD_VISIBLE_CONTENT, NEW_VISIBLE_CONTENT)
    .replace(OLD_TEXT_RENDER, NEW_TEXT_RENDER)
    .replace(OLD_VISIBLE_AFTER, NEW_VISIBLE_AFTER);
}

function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
}

function readState() {
  const resolved = paths();
  if (!fs.existsSync(resolved.target)) throw new Error(`Pi assistant renderer not found: ${resolved.target}`);
  const source = fs.readFileSync(resolved.target, "utf8");
  return { ...resolved, source, state: classify(source), version: packageVersion(resolved.packageJson) };
}

function status() {
  const current = readState();
  console.log(`Pi version: ${current.version}`);
  console.log(`Target: ${current.target}`);
  console.log(`Empty-comment patch: ${current.state}`);
  if (current.state === "compatible") console.log("Run with apply to install the explicit compatibility patch.");
  if (current.state === "mismatch") console.log("Source markers do not match; no changes will be made.");
}

function apply() {
  const current = readState();
  if (current.state === "applied") {
    console.log(`Already applied: ${current.target}`);
    return;
  }
  if (current.state !== "compatible") throw new Error("Refusing to patch: Pi source markers do not match the supported renderer.");
  if (fs.existsSync(current.backup) || fs.existsSync(current.metadata)) {
    throw new Error("Refusing to patch: backup or metadata already exists. Restore or inspect the previous patch state first.");
  }

  const patched = patchedSource(current.source);
  const stat = fs.statSync(current.target);
  fs.copyFileSync(current.target, current.backup, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(current.metadata, `${JSON.stringify({
    packageVersion: current.version,
    target: current.target,
    originalSha256: sha256(current.source),
    patchedSha256: sha256(patched),
    appliedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  atomicWrite(current.target, patched, stat.mode);
  console.log(`Applied empty-comment patch: ${current.target}`);
  console.log(`Backup: ${current.backup}`);
}

function restore() {
  const current = readState();
  if (!fs.existsSync(current.backup) || !fs.existsSync(current.metadata)) {
    throw new Error("Cannot restore: backup and metadata are required.");
  }
  const metadata = JSON.parse(fs.readFileSync(current.metadata, "utf8"));
  const backup = fs.readFileSync(current.backup, "utf8");
  if (sha256(backup) !== metadata.originalSha256) throw new Error("Refusing to restore: backup checksum mismatch.");
  if (sha256(current.source) !== metadata.patchedSha256) throw new Error("Refusing to restore: current renderer changed after patching.");

  const stat = fs.statSync(current.target);
  atomicWrite(current.target, backup, stat.mode);
  fs.unlinkSync(current.backup);
  fs.unlinkSync(current.metadata);
  console.log(`Restored original Pi assistant renderer: ${current.target}`);
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
