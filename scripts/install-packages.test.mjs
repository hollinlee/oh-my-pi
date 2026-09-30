import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPackages, selectedPackages } from "./install-packages.mjs";

test("select active/recommended packages, preserve git sources, skip optional", () => {
  assert.deepEqual([...selectedPackages({ core: { packages: [
    { name: "one", source: "npm", version: "^1", status: "active" },
    { name: "two", source: "git+https://example.com/two.git", status: "recommended" },
    { name: "three", source: "npm", status: "optional" },
  ] } })], [["one", "one@^1"], ["two", "git+https://example.com/two.git"]]);
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
