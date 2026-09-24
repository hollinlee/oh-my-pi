import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type RemoteDevice = {
  id: string;
  host: string;
  port?: number;
  defaultUser: string;
  auth?: { identityFile?: string };
  sshRoute?: { type?: string; target?: string; sshHost?: string; user?: string; identityFile?: string };
};

function expandHome(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

export function serialSshArgs(deviceId: string, remoteCommand: string, configPath = process.env.PI_REMOTE_DEVICES_CONFIG || join(homedir(), ".pi", "agent", "remote-devices", "devices.json")): string[] {
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { devices?: RemoteDevice[] };
  const device = parsed.devices?.find((item) => item.id === deviceId);
  if (!device) throw new Error(`serial remote device not configured: ${deviceId}`);
  const route = device.sshRoute?.type === "ssh-config" ? device.sshRoute : undefined;
  const user = route?.user || device.defaultUser;
  const target = route ? route.target || route.sshHost : device.host;
  if (!target || !user) throw new Error(`serial remote device has no SSH target/user: ${deviceId}`);
  const args = ["-tt", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
  if (!route) {
    const port = device.port ?? 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`serial remote device has invalid SSH port: ${deviceId}`);
    args.push("-p", String(port));
  }
  const identity = route?.identityFile || device.auth?.identityFile;
  if (identity) args.push("-i", expandHome(identity));
  args.push("-l", user, target, remoteCommand);
  return args;
}
