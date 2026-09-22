import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = path.join(import.meta.dirname, "patch-pi-empty-comments.mjs");

try {
  const result = await execFileAsync(process.execPath, [script, "apply"], { timeout: 30_000 });
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  console.log("Pi thinking compatibility patch applied or already active.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Pi thinking compatibility patch skipped; package installation continues. ${message}`);
}
