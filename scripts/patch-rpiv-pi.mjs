import fs from "node:fs";
import path from "node:path";

const PATCH_MARKER = "oh-my-pi: rpiv sibling detection patch v3";
const OLD_PATCH_MARKERS = [
  "oh-my-pi: rpiv sibling detection patch",
  "oh-my-pi: rpiv sibling detection patch v2",
];
const TARGET = "node_modules/@juicesharp/rpiv-pi/extensions/rpiv-core/package-checks.ts";
const IMPORT = 'import { createRequire } from "node:module";\nimport { existsSync } from "node:fs";\nimport path from "node:path";\n';
const HELPER = `
const localRequire = createRequire(import.meta.url);

/** Treat bundled sibling dependencies as installed for rpiv-pi's capability gate. */
function isLocallyResolvable(sibling: SiblingPlugin): boolean {
\tconst packageName = sibling.pkg.replace(/^npm:/, "");
\ttry {
\t\tlocalRequire.resolve(packageName + "/package.json");
\t\treturn true;
\t} catch {
\t\ttry {
\t\t\tlocalRequire.resolve(packageName);
\t\t\treturn true;
\t\t} catch {
\t\t\tlet directory = import.meta.dirname;
\t\t\tfor (let i = 0; i < 8; i += 1) {
\t\t\t\tif (existsSync(path.join(directory, "node_modules", packageName, "package.json"))) return true;
\t\t\t\tdirectory = path.dirname(directory);
\t\t\t}
\t\t\treturn false;
\t\t}
\t}
}
`;

function patchSource(source) {
  if (source.includes(PATCH_MARKER)) return source;
  const oldMarker = OLD_PATCH_MARKERS.find((marker) => source.includes(marker));
  if (oldMarker) {
    const markerIndex = source.indexOf(`// ${oldMarker}`);
    const functionIndex = source.indexOf("export function findMissingSiblings", markerIndex);
    if (markerIndex < 0 || functionIndex < 0) throw new Error("unsupported previous rpiv-pi patch layout");
    const withImports = source.includes('import { existsSync } from "node:fs";')
      ? source
      : source.replace('import { createRequire } from "node:module";\n', IMPORT);
    return `${withImports.slice(0, markerIndex)}// ${PATCH_MARKER}\n${HELPER}\n${withImports.slice(functionIndex)}`;
  }
  const importAnchor = 'import { SIBLINGS, type SiblingPlugin } from "./siblings.js";\n';
  const missingAnchor = "return SIBLINGS.filter((s) => !installed.some((entry) => s.matches.test(entry)));";
  const installedAnchor = "return SIBLINGS.filter((s) => installed.some((entry) => s.matches.test(entry)));";

  if (!source.includes(importAnchor) || !source.includes(missingAnchor) || !source.includes(installedAnchor)) {
    throw new Error("unsupported rpiv-pi package-checks.ts layout");
  }

  return source
    .replace(importAnchor, `${IMPORT}${importAnchor}`)
    .replace('export function findMissingSiblings(): SiblingPlugin[] {', `// ${PATCH_MARKER}\n${HELPER}\nexport function findMissingSiblings(): SiblingPlugin[] {`)
    .replace(missingAnchor, "return SIBLINGS.filter((s) => !installed.some((entry) => s.matches.test(entry)) && !isLocallyResolvable(s));")
    .replace(installedAnchor, "return SIBLINGS.filter((s) => installed.some((entry) => s.matches.test(entry)) || isLocallyResolvable(s));");
}

export function patchRpivSiblingDetection(root, fileSystem = fs) {
  const target = path.join(root, TARGET);
  if (!fileSystem.existsSync(target)) {
    console.log("oh-my-pi: rpiv-pi not installed; skipped sibling detection patch.");
    return false;
  }

  const source = fileSystem.readFileSync(target, "utf8");
  if (source.includes(PATCH_MARKER)) {
    console.log("oh-my-pi: rpiv sibling detection patch already applied.");
    return true;
  }

  try {
    const patched = patchSource(source);
    fileSystem.writeFileSync(target, patched, "utf8");
    console.log("oh-my-pi: patched rpiv-pi to detect bundled sibling packages.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`oh-my-pi: rpiv-pi patch skipped; sibling warning remains active. ${message}`);
    return false;
  }
}

export { PATCH_MARKER, patchSource };
