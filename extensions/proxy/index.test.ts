import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseProxy, readProxyStatus } from "./index.ts";

test("proxy status reads lower and upper case environment variables", () => {
  assert.deepEqual(readProxyStatus({}), { enabled: false, httpProxy: undefined, host: "127.0.0.1", port: 7897 });
  assert.equal(readProxyStatus({ HTTP_PROXY: "http://127.0.0.1:7897" }).enabled, true);
});

test("retry helper retries only explicitly idempotent operations", async () => {
  let attempts = 0;
  const result = await import("./index.ts").then(({ retryIdempotent }) => retryIdempotent(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary network failure");
    return "ok";
  }, true, 1));
  assert.equal(result, "ok");
  assert.equal(attempts, 2);

  let nonIdempotentAttempts = 0;
  await assert.rejects(() => import("./index.ts").then(({ retryIdempotent }) => retryIdempotent(async () => {
    nonIdempotentAttempts += 1;
    throw new Error("side effect may have happened");
  }, false, 3)), /side effect/);
  assert.equal(nonIdempotentAttempts, 1);
});
test("proxy diagnostics return bounded DNS and TCP result fields", async () => {
  const result = await diagnoseProxy("localhost");
  assert.equal(result.target, "localhost");
  assert.ok(result.dns && typeof result.dns === "object");
  assert.ok(result.proxyTcp && typeof result.proxyTcp === "object");
  assert.ok(["proxy_available_enable_with_permission", "proxy_configured_but_unreachable", "no_proxy_change_suggested"].includes(String(result.recommendation)));
});

