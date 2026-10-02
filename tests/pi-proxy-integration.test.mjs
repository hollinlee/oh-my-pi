import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(require.resolve("pi-proxy/extension")));

async function loadPackage(t) {
  const isolated = await mkdtemp(join(tmpdir(), "pi-proxy-load-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  const loaded = await discoverAndLoadExtensions([packageRoot], isolated, join(isolated, "agent"));
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  return loaded.extensions[0];
}

test("installed package metadata loads exactly three tools and retires legacy files", async (t) => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.pi.extensions, ["./src/extension.ts"]);
  assert.equal(rootManifest.dependencies["pi-proxy"], "git+https://github.com/hollinlee/pi-proxy.git");
  assert.equal(rootManifest.pi.extensions.filter((entry) => entry === "./node_modules/pi-proxy/src/extension.ts").length, 1);
  for (const file of ["extensions/proxy/index.ts", "extensions/proxy/index.test.ts"]) {
    await assert.rejects(access(join(root, file)), { code: "ENOENT" });
  }
  const extension = await loadPackage(t);
  assert.deepEqual([...extension.tools.keys()].sort(), [
    "proxy_runtime_diagnose",
    "proxy_runtime_recover",
    "proxy_runtime_status",
  ]);
  for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler();
});

test("status and headless/denied/pre-cancelled recovery stay fail-closed", async (t) => {
  const extension = await loadPackage(t);
  const tool = (name) => extension.tools.get(name).definition;
  const status = await tool("proxy_runtime_status").execute("test", {}, undefined, undefined, {});
  assert.equal(status.details.initialized, false);
  const recover = tool("proxy_runtime_recover");
  assert.equal((await recover.execute("test", { idempotent: true }, undefined, undefined, { hasUI: false })).details.reason, "confirmation-required");
  assert.equal((await recover.execute("test", { idempotent: false }, undefined, undefined, { hasUI: true, ui: { confirm: async () => false } })).details.reason, "permission-denied");
  await assert.rejects(recover.execute("test", { idempotent: true }, AbortSignal.abort(), undefined, { hasUI: true }), /proxy recovery cancelled/);
  for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler();
});

test("recovery wires authenticated selector, explicit HTTPS dispatcher, inherited env, and shutdown restore", async (t) => {
  const proxy = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => proxy.close(resolve)));
  const port = proxy.address().port;
  const env = {
    PROXY_HOST: "127.0.0.1",
    PROXY_PORT: String(port),
    PI_PROXY_CONTROLLER_URL: "http://127.0.0.1:9090",
    PI_PROXY_NODE_GROUP: "select",
    PI_PROXY_CONTROLLER_SECRET_REF: "main",
    PI_PROXY_SECRET_main: "test-secret",
    HTTP_PROXY: "before",
    NO_PROXY: "before-bypass",
  };
  const before = { ...env };
  const calls = [];
  let selected = "old";
  let githubRequests = 0;
  let dispatcherCloses = 0;
  const fetch = async (input, init) => {
    const url = new URL(String(input));
    const endpoint = url.pathname;
    if (endpoint === "/version" || endpoint.startsWith("/proxies")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    }
    if (endpoint === "/version") { calls.push("version"); return new Response(JSON.stringify({ version: "mock" })); }
    if (endpoint.endsWith("/delay")) { calls.push("delay"); return new Response(JSON.stringify({ delay: 12 })); }
    if (endpoint === "/proxies/select" && init?.method === "PUT") {
      calls.push("select");
      selected = JSON.parse(String(init.body)).name;
      return new Response(null, { status: 204 });
    }
    if (endpoint === "/proxies") {
      calls.push("proxies");
      return new Response(JSON.stringify({ proxies: { select: { type: "Selector", all: ["old", "new"], now: selected }, old: { type: "Http" }, new: { type: "Http" } } }));
    }
    throw new Error(`unexpected controller request: ${endpoint}`);
  };
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const load = (path) => jiti.import(pathToFileURL(join(packageRoot, "src", path)).href);
  const [{ createRuntime }, { readRuntimeConfig }, { runDiagnostics }] = await Promise.all([
    load("recovery.ts"), load("config.ts"), load("diagnostics.ts"),
  ]);
  const config = readRuntimeConfig(env);
  const runtime = await createRuntime({
    config,
    env,
    credentials: { get: async (ref) => ref === "main" ? "test-secret" : undefined },
    fetch,
    operations: {
      diagnose: (current, deps, controller, signal) => runDiagnostics(current, deps, controller, {
        signal,
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        proxyAgentFactory: (proxyUrl) => {
          assert.equal(proxyUrl, `http://127.0.0.1:${port}`);
          return { close: async () => { dispatcherCloses++; } };
        },
        httpsFetch: async (_url, init) => {
          assert.ok(init.dispatcher);
          calls.push("github");
          githubRequests++;
          return new Response(null, { status: githubRequests === 1 ? 503 : 204 });
        },
      }),
    },
  });
  const result = await runtime.recover({ idempotent: true });
  assert.equal(result.recovered, true);
  assert.deepEqual(calls, ["github", "version", "proxies", "delay", "select", "proxies", "github"]);
  assert.equal(selected, "new");
  assert.equal(dispatcherCloses, 2);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
  const child = execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify({http:process.env.HTTP_PROXY,all:process.env.ALL_PROXY}))"], { env: { ...process.env, ...env }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(child), { http: `http://127.0.0.1:${port}`, all: `http://127.0.0.1:${port}` });
  await runtime.shutdown();
  assert.deepEqual(env, before);
});
