import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { serialSshArgs } from "./ssh-route.ts";

test("serial remote route uses configured FRP host, port, user and key", () => {
  const config = join(mkdtempSync(join(tmpdir(), "serial-ssh-")), "devices.json");
  writeFileSync(config, JSON.stringify({ devices: [{ id: "device2", host: "139.196.76.70", port: 47042, defaultUser: "Hollins-Debian", auth: { identityFile: "~/.ssh/id_ed25519" } }] }));
  const args = serialSshArgs("device2", "picocom '/dev/ttyUSB0' -b 115200", config);
  assert.deepEqual(args.slice(0, 7), ["-tt", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]);
  assert.deepEqual(args.slice(7, 9), ["-p", "47042"]);
  assert.deepEqual(args.slice(-4), ["-l", "Hollins-Debian", "139.196.76.70", "picocom '/dev/ttyUSB0' -b 115200"]);
  assert.ok(args.includes("-i"));
  assert.throws(() => serialSshArgs("missing", "true", config), /not configured/);
});

test("ssh-config route retains its alias and configured user", () => {
  const config = join(mkdtempSync(join(tmpdir(), "serial-ssh-")), "devices.json");
  writeFileSync(config, JSON.stringify({ devices: [{ id: "compiler", host: "10.0.0.1", defaultUser: "fallback", sshRoute: { type: "ssh-config", target: "build-host", user: "builder" } }] }));
  const args = serialSshArgs("compiler", "true", config);
  assert.deepEqual(args.slice(-4), ["-l", "builder", "build-host", "true"]);
  assert.equal(args.includes("-p"), false);
});
