import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SUBAGENT_CONFIG_VERSION = 1;

export type SubagentModelConfig = {
  provider: string;
  model: string;
};

export type SubagentConfig = {
  version: typeof SUBAGENT_CONFIG_VERSION;
  enabled: boolean;
  defaultModel?: SubagentModelConfig;
};

export type SubagentConfigLoad = {
  path: string;
  config?: SubagentConfig;
  error?: string;
};

export function subagentConfigPath(home = os.homedir()): string {
  return path.join(home, ".pi", "agent", "subagent", "config.json");
}

function isModelConfig(value: unknown): value is SubagentModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return typeof model.provider === "string" && model.provider.trim().length > 0
    && typeof model.model === "string" && model.model.trim().length > 0
    && Object.keys(model).every((key) => key === "provider" || key === "model");
}

export function parseSubagentConfig(value: unknown): SubagentConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const config = value as Record<string, unknown>;
  if (config.version !== SUBAGENT_CONFIG_VERSION || typeof config.enabled !== "boolean") return undefined;
  if (config.defaultModel !== undefined && !isModelConfig(config.defaultModel)) return undefined;
  if (!Object.keys(config).every((key) => key === "version" || key === "enabled" || key === "defaultModel")) return undefined;
  return {
    version: SUBAGENT_CONFIG_VERSION,
    enabled: config.enabled,
    ...(config.defaultModel ? {
      defaultModel: {
        provider: config.defaultModel.provider.trim(),
        model: config.defaultModel.model.trim(),
      },
    } : {}),
  };
}

export function readSubagentConfig(file = subagentConfigPath()): SubagentConfigLoad {
  if (!existsSync(file)) return { path: file, config: { version: SUBAGENT_CONFIG_VERSION, enabled: false } };
  try {
    const config = parseSubagentConfig(JSON.parse(readFileSync(file, "utf8")));
    if (!config) return { path: file, error: "Invalid subagent config schema." };
    return { path: file, config };
  } catch (error) {
    return { path: file, error: `Unable to read subagent config: ${(error as Error).message}` };
  }
}

export function writeSubagentConfig(config: SubagentConfig, file = subagentConfigPath()): void {
  const parsed = parseSubagentConfig(config);
  if (!parsed) throw new Error("Invalid subagent config schema.");
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
    chmodSync(file, 0o600);
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* preserve the original write error */ }
    throw new Error(`Failed to write subagent config: ${(error as Error).message}`);
  }
}
