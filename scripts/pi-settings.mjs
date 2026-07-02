import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export async function readSettings(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeSettings(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(message, resolve));
    return String(answer).trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export function getPackageEntries(settings) {
  return Array.isArray(settings.packages) ? settings.packages : [];
}
