import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publicSerialProfile, readSerialProfiles, resolveSerialProfile, writeSerialProfiles, type SerialCredentialStore, type SerialProfile } from "./profiles.ts";

const profile: SerialProfile = {
  id: "board-a",
  transport: { type: "remote", device: "compiler-server" },
  port: "/dev/serial/by-id/usb-board",
  baud: 115200,
  username: "root",
  credentialRef: "board-a",
};

test("serial profiles round-trip with private file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "serial-profiles-"));
  const path = join(dir, "profiles.json");
  await writeSerialProfiles([profile], path);
  assert.deepEqual(await readSerialProfiles(path), [profile]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await readFile(path, "utf8")).includes("password"), false);
});

test("profile resolution is explicit and public output excludes credential reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "serial-profiles-"));
  const path = join(dir, "profiles.json");
  await writeSerialProfiles([profile], path);
  const resolved = await resolveSerialProfile("board-a", path);
  assert.equal(resolved.id, "board-a");
  assert.equal("credentialRef" in publicSerialProfile(resolved), false);
});

test("invalid profile and missing profile are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "serial-profiles-"));
  const path = join(dir, "profiles.json");
  await assert.rejects(writeSerialProfiles([{ ...profile, transport: { type: "remote" } } as SerialProfile], path), /remote transport/);
  await assert.rejects(resolveSerialProfile("missing", path), /未找到/);
});

test("credential store contract does not expose values through profile data", () => {
  const store: SerialCredentialStore = { get: async () => ({ username: "root", password: "secret" }), set: async () => {} };
  assert.equal(typeof store.get, "function");
  assert.equal("password" in publicSerialProfile(profile), false);
});
