import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getMineruStatus,
  MINERU_DISCLOSURE_LINES,
  MINERU_KEYCHAIN_SERVICE,
  mineruConfigPath,
  readMineruAuthorization,
  resolveMineruToken,
  revokeMineruAuthorization,
  setupMineruAuthorization,
  type MineruKeychain,
} from "./config.ts";

class FakeKeychain implements MineruKeychain {
  values = new Map<string, string>();
  deleted: string[] = [];

  async get(service: string): Promise<string | undefined> {
    return this.values.get(service);
  }

  async set(service: string, token: string): Promise<void> {
    this.values.set(service, token);
  }

  async delete(service: string): Promise<void> {
    this.deleted.push(service);
    this.values.delete(service);
  }
}

async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "oh-my-pi-mineru-"));
  return { stateDir, keychain: new FakeKeychain() };
}

test("cloud disclosure is centralized and includes the retention and cancellation boundaries", () => {
  const disclosure = MINERU_DISCLOSURE_LINES.join("\n");
  assert.match(disclosure, /up to 30 days/);
  assert.match(disclosure, /does not guarantee that remote processing stops/);
});

test("environment token takes priority and status never exposes the token", async () => {
  const { stateDir, keychain } = await fixture();
  keychain.values.set(MINERU_KEYCHAIN_SERVICE, "keychain-secret");
  const env = { MINERU_TOKEN: "environment-secret" } as NodeJS.ProcessEnv;
  const resolved = await resolveMineruToken({ stateDir, keychain, env });
  assert.equal(resolved.source, "environment");
  assert.equal(resolved.token, "environment-secret");
  assert.equal(resolved.id?.length, 10);

  const status = await getMineruStatus({ stateDir, keychain, env });
  assert.equal(status.configured, true);
  assert.equal(status.authorized, false);
  assert.equal(status.ready, false);
  assert.equal(JSON.stringify(status).includes("environment-secret"), false);
});

test("setup writes the keychain and a non-secret authorization marker", async () => {
  const { stateDir, keychain } = await fixture();
  const env = { MINERU_TOKEN: "setup-secret", USER: "tester" } as NodeJS.ProcessEnv;
  const now = () => new Date("2026-07-17T10:00:00.000Z");
  const status = await setupMineruAuthorization({ stateDir, keychain, env, platform: "darwin", now });

  assert.equal(keychain.values.get(MINERU_KEYCHAIN_SERVICE), "setup-secret");
  assert.equal(status.ready, true);
  assert.equal(status.authorization?.authorizedAt, "2026-07-17T10:00:00.000Z");

  const configPath = mineruConfigPath({ stateDir, env });
  const raw = await readFile(configPath, "utf8");
  assert.equal(raw.includes("setup-secret"), false);
  assert.equal(JSON.parse(raw).cloudUploadAuthorized, true);
  if (process.platform !== "win32") assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});

test("token and authorization marker are independent", async () => {
  const { stateDir, keychain } = await fixture();
  keychain.values.set(MINERU_KEYCHAIN_SERVICE, "stored-secret");
  const before = await getMineruStatus({ stateDir, keychain, env: {} });
  assert.equal(before.configured, true);
  assert.equal(before.authorized, false);
  assert.equal(before.ready, false);

  await setupMineruAuthorization({ stateDir, keychain, env: {}, platform: "darwin" });
  const authorization = await readMineruAuthorization({ stateDir });
  assert.equal(authorization?.cloudUploadAuthorized, true);
});

test("revoke removes the marker and only deletes the keychain when requested", async () => {
  const { stateDir, keychain } = await fixture();
  keychain.values.set(MINERU_KEYCHAIN_SERVICE, "stored-secret");
  await setupMineruAuthorization({ stateDir, keychain, env: {}, platform: "darwin" });

  let status = await revokeMineruAuthorization(false, { stateDir, keychain, env: {}, platform: "darwin" });
  assert.equal(status.authorized, false);
  assert.equal(status.configured, true);
  assert.equal(keychain.deleted.length, 0);

  await setupMineruAuthorization({ stateDir, keychain, env: {}, platform: "darwin" });
  status = await revokeMineruAuthorization(true, { stateDir, keychain, env: {}, platform: "darwin" });
  assert.equal(status.authorized, false);
  assert.equal(status.configured, false);
  assert.deepEqual(keychain.deleted, [MINERU_KEYCHAIN_SERVICE]);
});

test("kill switch makes an otherwise configured capability not ready", async () => {
  const { stateDir, keychain } = await fixture();
  const env = { MINERU_TOKEN: "secret", OH_MY_PI_MINERU_DISABLED: "1" } as NodeJS.ProcessEnv;
  await setupMineruAuthorization({ stateDir, keychain, env, platform: "darwin" });
  const status = await getMineruStatus({ stateDir, keychain, env });
  assert.equal(status.disabled, true);
  assert.equal(status.ready, false);
});
