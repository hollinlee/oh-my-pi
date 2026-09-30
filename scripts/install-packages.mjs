import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const resourceTypes = ["extensions", "skills", "prompts", "themes"];

export function selectedPackages(config) {
  const packages = new Map();
  for (const section of Object.values(config)) {
    for (const pkg of section?.packages ?? []) {
      if (!["active", "recommended"].includes(pkg.status)) continue;
      if (!pkg.name || !pkg.source) throw new Error("Managed package requires name and source");
      packages.set(pkg.name, pkg.source === "npm" ? `${pkg.name}@${pkg.version || "latest"}` : pkg.source);
    }
  }
  return packages;
}

export function installPackages(root, run = execFileSync) {
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const manifestPath = path.join(root, "package.json");
  const manifest = readJson(manifestPath);
  const selected = selectedPackages(readJson(path.join(root, "config/packages.json")));
  const names = new Set([...Object.keys(manifest.dependencies ?? {}), ...selected.keys()]);
  const missing = [];
  for (const name of names) {
    if (!fs.existsSync(path.join(root, "node_modules", name, "package.json"))) {
      const spec = manifest.dependencies?.[name];
      missing.push(spec ? (/^(git|https?:|file:)/.test(spec) ? spec : `${name}@${spec}`) : selected.get(name));
    }
  }
  if (missing.length) {
    run("npm", ["install", "--no-save", "--package-lock=false", "--omit=peer", ...missing], {
      cwd: root, stdio: "inherit", timeout: 600_000,
      env: { ...process.env, OH_MY_PI_INSTALLING_PACKAGES: "1" },
    });
  }

  manifest.pi ??= {};
  for (const type of resourceTypes) {
    // Rebuild dependency paths so removed/upgraded packages leave no stale entries.
    const resources = (manifest.pi[type] ?? []).filter((entry) => !entry.replace(/^\.\//, "").startsWith("node_modules/"));
    for (const name of names) {
      const dependency = readJson(path.join(root, "node_modules", name, "package.json"));
      for (const entry of dependency.pi?.[type] ?? []) {
        const exclude = entry.startsWith("!");
        const relative = (exclude ? entry.slice(1) : entry).replace(/^\.\//, "");
        if (path.isAbsolute(relative) || relative.split("/").includes("..")) throw new Error(`Invalid resource path in ${name}: ${entry}`);
        resources.push(`${exclude ? "!" : ""}./node_modules/${name}/${relative}`);
      }
    }
    if (resources.length || manifest.pi[type]) manifest.pi[type] = [...new Set(resources)];
  }
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  if (fs.readFileSync(manifestPath, "utf8") !== output) fs.writeFileSync(manifestPath, output);
  console.log(`oh-my-pi: checked ${names.size} dependencies; installed ${missing.length}; registered Pi resources.`);
}
