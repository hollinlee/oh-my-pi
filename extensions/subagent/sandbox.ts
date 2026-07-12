import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { createBashTool, type BashOperations, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SubagentTask } from "./schemas.ts";

const SENSITIVE_READ_PATHS = [".ssh", ".aws", ".gnupg", ".config/gh", ".docker"];
const SENSITIVE_WRITE_PATHS = [".git", ".env"];
let sandboxQueue: Promise<void> = Promise.resolve();

async function acquireSandbox(): Promise<() => void> {
  const previous = sandboxQueue;
  let release!: () => void;
  sandboxQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}

function sandboxedOperations(): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (signal?.aborted) throw new Error("aborted");
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, undefined, signal);
      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", wrapped], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
        let timedOut = false;
        const kill = () => {
          if (!child.pid) return;
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        };
        const timer = timeout && timeout > 0 ? setTimeout(() => { timedOut = true; kill(); }, timeout * 1000) : undefined;
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        const onAbort = () => kill();
        signal?.addEventListener("abort", onAbort, { once: true });
        child.on("error", reject);
        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) reject(new Error("aborted"));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolve({ exitCode: code });
        });
      });
    },
  };
}

export function assertCommandAllowed(command: string, overrides: ReadonlySet<string>): void {
  const networkAllowed = overrides.has("network") || overrides.has("package-install");
  const gitMutationAllowed = overrides.has("git-mutation");
  if (/\b(?:sudo|su)\b/.test(command)) throw new Error("SUBAGENT_PERMISSION_DENIED: privilege escalation is blocked");
  if (!gitMutationAllowed && /\bgit\s+(?:commit|push|merge|rebase|reset|clean|checkout|switch|branch\s+-[dD])\b/.test(command)) {
    throw new Error("SUBAGENT_PERMISSION_DENIED: git mutation is blocked");
  }
  if (!overrides.has("package-install") && /\b(?:npm|pnpm|yarn|pip|pip3|cargo|brew|apt|dnf)\s+(?:install|add|update|upgrade)\b/.test(command)) {
    throw new Error("SUBAGENT_PERMISSION_DENIED: package installation is blocked");
  }
  if (!networkAllowed && /\b(?:curl|wget|ssh|scp|nc|ncat|telnet)\b/.test(command)) {
    throw new Error("SUBAGENT_PERMISSION_DENIED: network commands are blocked");
  }
}

export async function createSandboxedBash(task: SubagentTask, sessionCwd: string): Promise<{ tool: ToolDefinition; cleanup: () => Promise<void> }> {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(`workspace-write sandbox is unsupported on ${process.platform}`);
  }
  const release = await acquireSandbox();
  const cwd = path.resolve(sessionCwd);
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const canonicalCwd = fs.realpathSync.native(cwd);
  const relativeToTemp = path.relative(tempRoot, canonicalCwd);
  if (relativeToTemp === "" || (!relativeToTemp.startsWith("..") && !path.isAbsolute(relativeToTemp))) {
    release();
    throw new Error("workspace-write sandbox refuses workspaces under the system temp directory; use a non-temporary workspace path");
  }
  const overrides = new Set(task.capability.overrides ?? []);
  const networkAllowed = overrides.has("network") || overrides.has("package-install");
  try {
    await SandboxManager.initialize({
    network: {
      allowedDomains: networkAllowed ? ["github.com", "*.github.com", "registry.npmjs.org"] : [],
      deniedDomains: [],
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: SENSITIVE_READ_PATHS.map((entry) => path.join(os.homedir(), entry)),
      allowWrite: [cwd],
      denyWrite: [
        os.tmpdir(),
        ...SENSITIVE_WRITE_PATHS.map((entry) => path.join(cwd, entry)),
        ...fs.readdirSync(cwd).filter((entry) => /^\.env(?:\.|$)/.test(entry)).map((entry) => path.join(cwd, entry)),
      ],
    },
    enableWeakerNestedSandbox: false,
    });
  } catch (error) {
    release();
    throw error;
  }
  const base = createBashTool(cwd, { operations: sandboxedOperations() });
  const tool: ToolDefinition = {
    ...base,
    label: "bash (subagent sandbox)",
    async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const command = String(params.command ?? "");
      assertCommandAllowed(command, overrides);
      return base.execute(id, params, signal, onUpdate, ctx);
    },
  } as ToolDefinition;
  return {
    tool,
    cleanup: async () => {
      try { await SandboxManager.reset(); } finally { release(); }
    },
  };
}
