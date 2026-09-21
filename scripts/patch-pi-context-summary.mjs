import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start) {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        if (JSON.parse(fs.readFileSync(packagePath, "utf8")).name === "@earendil-works/pi-coding-agent") return current;
      } catch {}
    }
    current = path.dirname(current);
  }
}

function piRoot() {
  const pathEntries = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, process.platform === "win32" ? "pi.exe" : "pi");
    if (!fs.existsSync(candidate)) continue;
    const root = findRoot(path.dirname(fs.realpathSync(candidate)));
    if (root) return root;
  }
  return findRoot(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
}

const root = process.env.OH_MY_PI_CODING_AGENT_ROOT
  ? path.resolve(process.env.OH_MY_PI_CODING_AGENT_ROOT)
  : piRoot();
if (!root) throw new Error("Unable to locate the active @earendil-works/pi-coding-agent package root.");

const CONTEXT_EXCLUSION = 'm.customType === "oh-my-pi.turn-summary" || m.customType === "oh-my-pi.turn-tools" || m.customType === "oh-my-pi.turn-result"';
const BUNDLE_CONTEXT_EXCLUSION = 'm2.customType==="oh-my-pi.turn-summary"||m2.customType==="oh-my-pi.turn-tools"||m2.customType==="oh-my-pi.turn-result"';

const corePath = path.join(root, "dist", "core", "messages.js");
const bundleDir = path.join(root, "dist", "bundle", "chunks");
const coreOld = '            case "custom": {\n                const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;';
const coreNew = '            case "custom": {\n                if (m.customType === "oh-my-pi.turn-summary" || m.customType === "oh-my-pi.turn-tools" || m.customType === "oh-my-pi.turn-result") return undefined;\n                const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;';

function patchCore() {
  const source = fs.readFileSync(corePath, "utf8");
  if (source.includes(CONTEXT_EXCLUSION)) return "applied";
  if (source.includes('m.customType === "oh-my-pi.turn-summary"')) throw new Error(`Unsupported partial context exclusion patch: ${corePath}`);
  if (!source.includes(coreOld)) throw new Error(`Unsupported Pi messages renderer: ${corePath}`);
  fs.writeFileSync(corePath, source.replace(coreOld, coreNew));
  return "applied";
}

function patchBundle(file) {
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes('case"custom":return{role:"user"') && !source.includes('m2.customType==="oh-my-pi.turn-summary"')) return false;
  if (source.includes(BUNDLE_CONTEXT_EXCLUSION)) return true;
  if (source.includes('m2.customType==="oh-my-pi.turn-summary"')) throw new Error(`Unsupported partial bundle context exclusion patch: ${file}`);
  const pattern = /case"custom":return\{role:"user",content:typeof m2\.content=="string"\?\[\{type:"text",text:m2\.content\}\]:m2\.content,timestamp:m2\.timestamp\};/g;
  const replacement = 'case"custom":return m2.customType==="oh-my-pi.turn-summary"||m2.customType==="oh-my-pi.turn-tools"||m2.customType==="oh-my-pi.turn-result"?void 0:{role:"user",content:typeof m2.content=="string"?[{type:"text",text:m2.content}]:m2.content,timestamp:m2.timestamp};';
  const next = source.replace(pattern, replacement);
  if (next === source) return false;
  fs.writeFileSync(file, next);
  return true;
}

const command = process.argv[2] ?? "apply";
if (command === "status") {
  const core = fs.readFileSync(corePath, "utf8");
  const bundles = fs.readdirSync(bundleDir).filter((name) => name.endsWith(".js"));
  const bundle = bundles.some((name) => {
    const source = fs.readFileSync(path.join(bundleDir, name), "utf8");
    return source.includes(BUNDLE_CONTEXT_EXCLUSION);
  });
  console.log(`Pi context summary patch: ${core.includes(CONTEXT_EXCLUSION) && bundle ? "applied" : "not applied"}`);
} else if (command === "apply") {
  const bundle = fs.readdirSync(bundleDir).filter((name) => name.endsWith(".js"))
    .map((name) => path.join(bundleDir, name)).filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return source.includes(BUNDLE_CONTEXT_EXCLUSION) || source.includes('case"custom":return{role:"user"');
    });
  if (bundle.length !== 1) throw new Error(`Expected exactly one Pi bundled messages renderer, found ${bundle.length} under ${bundleDir}`);
  console.log(`Pi context summary patch: ${patchCore()} (${patchBundle(bundle[0]) ? "applied" : "unsupported"})`);
} else {
  throw new Error(`Unknown command: ${command}`);
}
