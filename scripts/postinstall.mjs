import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scripts = ["patch-pi-empty-comments.mjs", "patch-pi-transcript-surfaces.mjs"];

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