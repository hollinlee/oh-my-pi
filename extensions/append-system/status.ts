import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type AppendSystemMode = "disabled" | "local" | "bundled" | "unavailable";

export type AppendSystemStatus = {
  mode: AppendSystemMode;
  detail: string;
  path?: string;
  prompt?: string;
};

export type AppendSystemStatusOptions = {
  cwd: string;
  projectTrusted: boolean;
  nativeAppendConfigured?: boolean;
  disabled?: boolean;
  agentDir?: string;
  bundledPath?: string;
};

export const BUNDLED_APPEND_SYSTEM_PATH = fileURLToPath(
  new URL("../../system/APPEND_SYSTEM.md", import.meta.url),
);

function existingNativePath(cwd: string, projectTrusted: boolean, agentDir: string): string | undefined {
  const projectPath = path.join(cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
  if (projectTrusted && fs.existsSync(projectPath)) return projectPath;

  const globalPath = path.join(agentDir, "APPEND_SYSTEM.md");
  if (fs.existsSync(globalPath)) return globalPath;
  return undefined;
}

export function getAppendSystemStatus(options: AppendSystemStatusOptions): AppendSystemStatus {
  const disabled = options.disabled ?? (process.env.OH_MY_PI_APPEND_SYSTEM_DISABLED === "1");
  if (disabled) {
    return { mode: "disabled", detail: "OH_MY_PI_APPEND_SYSTEM_DISABLED=1" };
  }

  const nativePath = existingNativePath(
    options.cwd,
    options.projectTrusted,
    options.agentDir ?? getAgentDir(),
  );
  if (nativePath) return { mode: "local", detail: nativePath, path: nativePath };
  if (options.nativeAppendConfigured) {
    return { mode: "local", detail: "Pi native or CLI append system prompt configured (source path not exposed)" };
  }

  const bundledPath = options.bundledPath ?? BUNDLED_APPEND_SYSTEM_PATH;
  try {
    if (!fs.statSync(bundledPath).isFile()) {
      return { mode: "unavailable", detail: `bundled fallback is not a file: ${bundledPath}` };
    }
    const prompt = fs.readFileSync(bundledPath, "utf8").trim();
    if (!prompt) return { mode: "unavailable", detail: `bundled fallback is empty: ${bundledPath}` };
    return { mode: "bundled", detail: bundledPath, path: bundledPath, prompt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { mode: "unavailable", detail: `cannot read bundled fallback: ${message}` };
  }
}

export function applyAppendSystemFallback(systemPrompt: string, status: AppendSystemStatus): string {
  if (status.mode !== "bundled" || !status.prompt) return systemPrompt;
  return `${systemPrompt}\n\n${status.prompt}`;
}
