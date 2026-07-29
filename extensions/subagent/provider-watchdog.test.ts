import assert from "node:assert/strict";
import test from "node:test";
import { ProviderIdleWatchdog } from "./provider-watchdog.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("provider idle watchdog fires after inactivity", async () => {
  let calls = 0;
  const watchdog = new ProviderIdleWatchdog(30, () => { calls += 1; });
  watchdog.start();
  await wait(70);
  assert.equal(calls, 1);
  watchdog.stop();
});

test("provider activity refreshes the idle deadline", async () => {
  let calls = 0;
  const watchdog = new ProviderIdleWatchdog(100, () => { calls += 1; });
  watchdog.start();
  await wait(10);
  watchdog.touch();
  await wait(40);
  assert.equal(calls, 0);
  await wait(90);
  assert.equal(calls, 1);
  watchdog.stop();
});

test("stopping provider idle watchdog prevents timeout", async () => {
  let calls = 0;
  const watchdog = new ProviderIdleWatchdog(30, () => { calls += 1; });
  watchdog.start();
  watchdog.stop();
  await wait(70);
  assert.equal(calls, 0);
});
