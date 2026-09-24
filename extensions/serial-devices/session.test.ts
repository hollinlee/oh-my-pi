import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("remote serial read reports login state without exposing pre-login output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "serial-session-"));
  const ssh = join(dir, "ssh");
  writeFileSync(ssh, "#!/bin/sh\nprintf 'Terminal ready\\r\\nD2000 login: '\nexec cat\n");
  chmodSync(ssh, 0o755);
  const profiles = join(dir, "profiles.json");
  const devices = join(dir, "devices.json");
  writeFileSync(profiles, JSON.stringify({ version: 1, profiles: [{ id: "fixture", transport: { type: "remote", device: "fixture-host" }, port: "/dev/ttyUSB0", baud: 115200, username: "root", credentialRef: "fixture-credential" }] }));
  writeFileSync(devices, JSON.stringify({ devices: [{ id: "fixture-host", host: "127.0.0.1", port: 47042, defaultUser: "tester" }] }));
  const previous = { path: process.env.PATH, profiles: process.env.PI_SERIAL_PROFILES_CONFIG, devices: process.env.PI_REMOTE_DEVICES_CONFIG };
  process.env.PATH = `${dir}:${previous.path}`;
  process.env.PI_SERIAL_PROFILES_CONFIG = profiles;
  process.env.PI_REMOTE_DEVICES_CONFIG = devices;
  const tools = new Map<string, any>();
  const events = new Map<string, (...args: any[]) => any>();
  try {
    const { default: extension } = await import("./index.ts");
    extension({ on: (name: string, fn: (...args: any[]) => any) => events.set(name, fn), registerTool: (tool: any) => tools.set(tool.name, tool) } as any);
    const result = await tools.get("serial_read").execute("test", { profile: "fixture", lines: 10 });
    assert.match(result.content[0].text, /login-required/);
    assert.equal(result.content[0].text.includes("D2000 login:"), false);
    assert.equal(result.details.state, "login-required");
    assert.equal(result.details.consoleBytes, 0);
  } finally {
    await events.get("session_shutdown")?.();
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path;
    if (previous.profiles === undefined) delete process.env.PI_SERIAL_PROFILES_CONFIG; else process.env.PI_SERIAL_PROFILES_CONFIG = previous.profiles;
    if (previous.devices === undefined) delete process.env.PI_REMOTE_DEVICES_CONFIG; else process.env.PI_REMOTE_DEVICES_CONFIG = previous.devices;
  }
});
