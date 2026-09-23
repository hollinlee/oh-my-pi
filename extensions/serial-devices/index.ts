import { spawn as childSpawn } from "node:child_process";
import * as crypto from "node:crypto";
import type { IPty } from "node-pty";
import { spawn as ptySpawn } from "node-pty";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { OsSerialCredentialStore, publicSerialProfile, readSerialProfiles, resolveSerialProfile, type SerialProfile } from "./profiles.ts";

const DEFAULT_BAUD = 115200;
const DEFAULT_PORT = "/dev/ttyUSB0";
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 600;
const MAX_BUFFER_LINES = 2000;
const MAX_BUFFER_BYTES = 256 * 1024;
const MARKER_PREFIX = "__PI_SERIAL_DONE_";
const VALID_PORT_RE = /^\/dev\/[a-zA-Z0-9._\-/]+$/;

export type SerialExecResult = { stdout: string; exitCode: number; durationMs: number; timedOut: boolean };

type SerialSession = { profile: SerialProfile; pty: IPty; lines: string[]; bytes: number; state: "connecting" | "login-required" | "authenticating" | "shell-ready" | "bootloader" | "stale"; output: string };
const sessions = new Map<string, SerialSession>();
const locks = new Map<string, Promise<void>>();

function shellQuote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function marker(): string { return `${MARKER_PREFIX}${crypto.randomBytes(6).toString("hex")}_`; }
function validateLocalProfile(profile: SerialProfile): void {
  if (profile.transport.type !== "local") throw new Error(`serial profile ${profile.id} 不是 local transport；remote transport 由 #282 接入`);
  if (!VALID_PORT_RE.test(profile.port)) throw new Error(`串口路径不合法: ${profile.port}`);
}
function appendBuffer(session: SerialSession, text: string): void {
  session.output += text;
  for (const line of text.replace(/\r/g, "").split("\n").slice(0, -1)) session.lines.push(line);
  session.bytes += Buffer.byteLength(text);
  while (session.lines.length > MAX_BUFFER_LINES || session.bytes > MAX_BUFFER_BYTES) {
    const removed = session.lines.shift() ?? "";
    session.bytes -= Buffer.byteLength(`${removed}\n`);
  }
  if (session.output.length > MAX_BUFFER_BYTES) session.output = session.output.slice(-MAX_BUFFER_BYTES);
}
function detectState(session: SerialSession, text: string): void {
  const normalized = text.toLowerCase();
  if (/u-boot|opensbi|\b=>\s*$/.test(normalized)) session.state = "bootloader";
  else if (new RegExp(session.profile.prompts?.password ?? "password\\s*:").test(text)) session.state = "authenticating";
  else if (new RegExp(session.profile.prompts?.login ?? "(?:login|username)\\s*:", "i").test(text)) session.state = "login-required";
}
async function createLocalSession(profile: SerialProfile): Promise<SerialSession> {
  validateLocalProfile(profile);
  const command = profile.picocom?.command || "picocom";
  try {
    const pty = ptySpawn(command, [profile.port, "-b", String(profile.baud || DEFAULT_BAUD)], { name: "xterm", cols: 200, rows: 50, cwd: process.cwd(), env: process.env });
    const session: SerialSession = { profile, pty, lines: [], bytes: 0, state: "connecting", output: "" };
    pty.onData((text) => { appendBuffer(session, text); detectState(session, text); });
    pty.onExit(() => { if (session.state !== "stale") session.state = "stale"; });
    return session;
  } catch (error: any) {
    throw new Error(`serial-pty-unavailable: ${error?.message ?? String(error)}。请执行 npm_config_build_from_source=true npm rebuild node-pty`);
  }
}
async function ensureSession(profile: SerialProfile): Promise<SerialSession> {
  const existing = sessions.get(profile.id);
  if (existing && existing.state !== "stale") return existing;
  const session = await createLocalSession(profile);
  sessions.set(profile.id, session);
  await sleep(250);
  const credential = await new OsSerialCredentialStore().get(profile.credentialRef);
  if (session.state === "bootloader") throw new Error(`serial-bootloader-detected: ${profile.id}`);
  if (session.state === "login-required") {
    if (!credential) throw new Error(`serial-credential-required: ${profile.id}`);
    session.pty.write(`${credential.username}\r`);
    await sleep(150);
    session.pty.write(`${credential.password}\r`);
    session.state = "shell-ready";
  } else {
    session.state = "shell-ready";
  }
  return session;
}
async function withProfileLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(id, current);
  await previous;
  try { return await fn(); } finally { release(); if (locks.get(id) === current) locks.delete(id); }
}
async function execProfile(profile: SerialProfile, command: string, timeoutSeconds = DEFAULT_TIMEOUT_S, signal?: AbortSignal): Promise<SerialExecResult> {
  return withProfileLock(profile.id, async () => {
    const session = await ensureSession(profile);
    const id = marker();
    const start = Date.now();
    const before = session.output.length;
    const full = `${command}; printf '\\n${id}%s__\\n' "$?"`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: SerialExecResult) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(result); };
      const onData = (text: string) => {
        appendBuffer(session, text);
        const match = session.output.slice(before).match(new RegExp(`${id}(\\d+)__`));
        if (!match) return;
        session.pty.offData(onData);
        const output = session.output.slice(before).replace(new RegExp(`\\n${id}\\d+__\\n?`), "");
        finish({ stdout: output.trim(), exitCode: Number(match[1]), durationMs: Date.now() - start, timedOut: false });
      };
      const abort = () => { session.pty.write("\u0003"); session.state = "stale"; session.pty.offData(onData); finish({ stdout: session.output.slice(before).trim(), exitCode: -1, durationMs: Date.now() - start, timedOut: true }); };
      const timer = setTimeout(() => abort(), Math.min(Math.max(1, timeoutSeconds), MAX_TIMEOUT_S) * 1000);
      signal?.addEventListener("abort", abort, { once: true });
      session.pty.onData(onData);
      session.pty.write(`${full}\r`);
    });
  });
}
function dangerousReason(command: string): string | undefined { return /\b(reboot|shutdown|poweroff|halt|mkfs|dd)\b|\brm\s+-[^\n]*(r|f)/i.test(command) ? "疑似破坏性命令" : undefined; }
function formatResult(result: SerialExecResult): string { return `${result.stdout}${result.timedOut ? `\n[timeout ${Math.round(result.durationMs / 1000)}s]` : ""}\n[exit=${result.exitCode} duration=${result.durationMs}ms]`; }

export default function serialDevicesExtension(pi: ExtensionAPI) {
  pi.on("system_prompt", (event) => { event.systemPrompt += "\n\n[serial-devices] Use explicit serial profiles with direct picocom PTY transport. Credentials are stored in OS secure storage."; });
  pi.on("session_shutdown", async () => { for (const session of sessions.values()) session.pty.kill(); sessions.clear(); });
  pi.registerTool({ name: "serial_list_profiles", label: "Serial Devices: List Profiles", description: "列出 serial profiles，不显示 credential。", parameters: Type.Object({}), async execute() { const profiles = await readSerialProfiles(); return { content: [{ type: "text", text: profiles.map((p) => JSON.stringify(publicSerialProfile(p))).join("\n") || "No serial profiles configured." }], details: { profiles: profiles.map(publicSerialProfile) } }; } });
  pi.registerTool({ name: "serial_resolve_profile", label: "Serial Devices: Resolve Profile", description: "解析显式 serial profile。", parameters: Type.Object({ profile: Type.String() }), async execute(_id, params: any) { const profile = await resolveSerialProfile(params.profile); return { content: [{ type: "text", text: JSON.stringify(publicSerialProfile(profile), null, 2) }], details: { profile: publicSerialProfile(profile) } }; } });
  pi.registerTool({ name: "serial_set_credential", label: "Serial Devices: Set Credential", description: "将 serial credential 写入 OS secure storage。", parameters: Type.Object({ profile: Type.String(), username: Type.String(), password: Type.String() }), async execute(_id, params: any) { const profile = await resolveSerialProfile(params.profile); if (profile.username !== params.username) throw new Error("credential username 与 profile 不一致"); await new OsSerialCredentialStore().set(profile.credentialRef, params.username, params.password); return { content: [{ type: "text", text: `credential configured: ${profile.id}` }], details: { profile: profile.id, username: params.username } }; } });
  pi.registerTool({ name: "serial_exec", label: "Serial Devices: Exec", description: "通过 direct picocom PTY 在 serial profile 上执行 shell 命令。", parameters: Type.Object({ profile: Type.String(), command: Type.String(), timeout_seconds: Type.Optional(Type.Number()), allowDangerous: Type.Optional(Type.Boolean()) }), async execute(_id, params: any, signal) { const profile = await resolveSerialProfile(params.profile); const reason = dangerousReason(params.command); if (reason && !params.allowDangerous) throw new Error(`serial_exec 拒绝执行：${reason}`); const result = await execProfile(profile, params.command, params.timeout_seconds, signal); return { content: [{ type: "text", text: formatResult(result) }], details: { profile: profile.id, command: params.command, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs }, isError: result.exitCode !== 0 || result.timedOut }; } });
  pi.registerTool({ name: "serial_read", label: "Serial Devices: Read", description: "读取 serial profile 的 bounded rolling buffer。", parameters: Type.Object({ profile: Type.String(), lines: Type.Optional(Type.Number()) }), async execute(_id, params: any) { const profile = await resolveSerialProfile(params.profile); const session = await ensureSession(profile); const count = Math.min(MAX_BUFFER_LINES, Math.max(1, Math.floor(params.lines ?? 50))); const text = session.lines.slice(-count).join("\n"); return { content: [{ type: "text", text: text || "[serial buffer empty]" }], details: { profile: profile.id, lines: count, state: session.state } }; } });
}
