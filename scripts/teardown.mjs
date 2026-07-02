import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, getPackageEntries, readSettings, writeSettings } from "./pi-settings.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const globalSettings = path.join(os.homedir(), ".pi", "agent", "settings.json");
const settingsDir = path.dirname(globalSettings);

function resolvesToRepoRoot(entry) {
  if (typeof entry !== "string") return false;
  const resolved = path.resolve(settingsDir, entry);
  return resolved === repoRoot;
}

async function main() {
  const settings = await readSettings(globalSettings);
  const packages = getPackageEntries(settings);

  if (!packages.some(resolvesToRepoRoot)) {
    console.log(`Not registered in ${globalSettings}`);
    console.log(` path: ${repoRoot}`);
    return;
  }

  console.log("The following change will be made:\n");
  console.log(` file: ${globalSettings}`);
  console.log(` action: remove \"${repoRoot}\" from packages\n`);

  const ok = await confirm("Proceed? [y/N] ");
  if (!ok) {
    console.log("Aborted. No changes were made.");
    return;
  }

  settings.packages = packages.filter((entry) => !resolvesToRepoRoot(entry));
  await writeSettings(globalSettings, settings);
  console.log("Done. Restart pi or run /reload.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
