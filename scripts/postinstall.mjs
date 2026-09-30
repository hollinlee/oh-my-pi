import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { installPackages } from "./install-packages.mjs";

// npm may re-enter this lifecycle when installing a missing managed dependency.
if (process.env.OH_MY_PI_INSTALLING_PACKAGES === "1") process.exit(0);
installPackages(path.resolve(import.meta.dirname, ".."));

const execFileAsync = promisify(execFile);
const scripts = ["install-append-system.mjs", "patch-pi-empty-comments.mjs", "patch-pi-transcript-surfaces.mjs"];

for (const script of scripts) {
  try {
    const result = await execFileAsync(process.execPath, [path.join(import.meta.dirname, script), "apply"], { timeout: 30_000 });
    if (result.stdout.trim()) process.stdout.write(result.stdout);
    if (result.stderr.trim()) process.stderr.write(result.stderr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Pi compatibility patch skipped for ${script}; package installation continues. ${message}`);
  }
}

console.log("Pi compatibility patches applied or already active.");