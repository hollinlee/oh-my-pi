import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { installPackages } from "./install-packages.mjs";
import { patchRpivSiblingDetection } from "./patch-rpiv-pi.mjs";

// npm may re-enter this lifecycle when installing a missing managed dependency.
if (process.env.OH_MY_PI_INSTALLING_PACKAGES === "1") process.exit(0);
installPackages(path.resolve(import.meta.dirname, ".."));
patchRpivSiblingDetection(path.resolve(import.meta.dirname, ".."));

const execFileAsync = promisify(execFile);
const scripts = ["install-append-system.mjs"];

async function configurePiLens() {
  const piLensConfigDir = path.join(os.homedir(), ".pi-lens");
  const piLensConfigPath = path.join(piLensConfigDir, "config.json");
  
  const config = {
    "$schema": "https://raw.githubusercontent.com/apmantza/pi-lens/master/docs/schema/pi-lens-config-v1.json",
    "widget": {
      "visible": false
    },
    "ui": {
      "hideLspStatus": true
    }
  };

  try {
    const fs = await import("node:fs/promises");
    await fs.mkdir(piLensConfigDir, { recursive: true });
    await fs.writeFile(piLensConfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    console.log("pi-lens configured: widget and LSP status hidden.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`pi-lens config write failed; continuing. ${message}`);
    return false;
  }
}

for (const script of scripts) {
  try {
    const result = await execFileAsync(process.execPath, [path.join(import.meta.dirname, script), "apply"], { timeout: 30_000 });
    if (result.stdout.trim()) process.stdout.write(result.stdout);
    if (result.stderr.trim()) process.stderr.write(result.stderr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Setup script skipped for ${script}; package installation continues. ${message}`);
  }
}

await configurePiLens();
console.log("oh-my-pi postinstall complete.");
