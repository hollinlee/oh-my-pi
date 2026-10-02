import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPackages, selectedPackages } from "./install-packages.mjs";
import { PATCH_MARKER, patchSource, patchRpivSiblingDetection } from "./patch-rpiv-pi.mjs";

test("select active/recommended packages, preserve git sources, skip optional", () => {
  assert.deepEqual([...selectedPackages({ core: { packages: [
    { name: "one", source: "npm", version: "^1", status: "active" },
    { name: "two", source: "git+https://example.com/two.git", status: "recommended" },
    { name: "three", source: "npm", status: "optional" },
  ] } })], [["one", "one@^1"], ["two", "git+https://example.com/two.git"]]);
});

test("patch bundled rpiv-pi sibling detection idempotently", () => {
  const source = `import { SIBLINGS, type SiblingPlugin } from "./siblings.js";\n\nexport function findMissingSiblings(): SiblingPlugin[] {\n\treturn SIBLINGS.filter((s) => !installed.some((entry) => s.matches.test(entry)));\n}\n\nexport function findInstalledSiblings(): SiblingPlugin[] {\n\treturn SIBLINGS.filter((s) => installed.some((entry) => s.matches.test(entry)));\n}`;
  const patched = patchSource(source);
  assert.match(patched, new RegExp(PATCH_MARKER));
  assert.match(patched, /localRequire\.resolve\(packageName \+ "\/package\.json"\)/);
  assert.match(patched, /!isLocallyResolvable\(s\)/);
  assert.match(patched, /\|\| isLocallyResolvable\(s\)/);
  assert.equal(patchSource(patched), patched);
});

test("patch rpiv-pi from the package root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpiv-patch-"));
  const target = path.join(root, "node_modules/@juicesharp/rpiv-pi/extensions/rpiv-core/package-checks.ts");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `import { SIBLINGS, type SiblingPlugin } from "./siblings.js";\n\nexport function findMissingSiblings(): SiblingPlugin[] {\n\treturn SIBLINGS.filter((s) => !installed.some((entry) => s.matches.test(entry)));\n}\n\nexport function findInstalledSiblings(): SiblingPlugin[] {\n\treturn SIBLINGS.filter((s) => installed.some((entry) => s.matches.test(entry)));\n}`);
  try {
    assert.equal(patchRpivSiblingDetection(root), true);
    assert.equal(patchRpivSiblingDetection(root), true);
    assert.match(fs.readFileSync(target, "utf8"), new RegExp(PATCH_MARKER));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install missing packages and register resources idempotently without a shell", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-packages-"));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(value));
  };
  try {
    write("package.json", { dependencies: { question: "^1" }, pi: { extensions: ["./extensions", "./node_modules/old/index.ts"] } });
    write("config/packages.json", {});
    let calls = 0;
    const run = (command, args, options) => {
      calls++;
      assert.equal(command, "npm");
      assert.ok(args.includes("question@^1"));
      assert.equal(options.env.OH_MY_PI_INSTALLING_PACKAGES, "1");
      write("node_modules/question/package.json", { pi: { extensions: ["./index.ts"], skills: ["./skills"] } });
    };
    installPackages(root, run);
    const first = fs.readFileSync(path.join(root, "package.json"), "utf8");
    assert.deepEqual(JSON.parse(first).pi.extensions, ["./extensions", "./node_modules/question/index.ts"]);
    installPackages(root, run);
    assert.equal(calls, 1);
    assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pi-proxy git dependency metadata merges once and preserves local resources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-proxy-merge-"));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
  };
  const source = "git+https://github.com/hollinlee/pi-proxy.git";
  try {
    write("package.json", {
      dependencies: { "pi-proxy": source, question: "^1" },
      pi: { extensions: ["./extensions", "./node_modules/old-proxy/index.ts"], skills: ["./skills"], themes: ["./themes/base.json"] },
    });
    write("config/packages.json", {});
    let calls = 0;
    const run = (command, args, options) => {
      calls++;
      assert.equal(command, "npm");
      assert.ok(args.includes(source));
      assert.ok(args.includes("--omit=peer"));
      assert.equal(options.cwd, root);
      write("node_modules/pi-proxy/package.json", { pi: { extensions: ["./src/extension.ts"], skills: ["./skills"] } });
      write("node_modules/question/package.json", { pi: { extensions: ["./index.ts"] } });
    };
    installPackages(root, run);
    const first = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const manifest = JSON.parse(first);
    assert.deepEqual(manifest.pi.extensions, ["./extensions", "./node_modules/pi-proxy/src/extension.ts", "./node_modules/question/index.ts"]);
    assert.deepEqual(manifest.pi.skills, ["./skills", "./node_modules/pi-proxy/skills"]);
    assert.deepEqual(manifest.pi.themes, ["./themes/base.json"]);
    assert.equal(manifest.pi.extensions.includes("./node_modules/old-proxy/index.ts"), false);
    installPackages(root, () => assert.fail("installed dependencies must not be reinstalled"));
    assert.equal(calls, 1);
    assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
