import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type ApiType = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
type InputMode = "text" | "text,image";

type ModelConfig = {
  id: string;
  name?: string;
  api?: ApiType;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: Record<string, boolean>;
};

type ProviderConfig = {
  baseUrl?: string;
  api?: ApiType;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, boolean>;
  models?: ModelConfig[];
  modelOverrides?: Record<string, unknown>;
};

type ModelsJson = {
  providers?: Record<string, ProviderConfig>;
};

const MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");
const API_TYPES: ApiType[] = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseModelIds(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function buildApiKeyRef(providerId: string, authChoice: string, detail: string): string | undefined {
  if (authChoice.startsWith("Keychain")) {
    const service = detail.trim() || `pi-model-api-key-${providerId}`;
    return `!security find-generic-password -a \"$USER\" -s ${service} -w`;
  }
  if (authChoice.startsWith("Environment")) {
    const envName = detail.trim() || `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    return `$${envName}`;
  }
  if (authChoice.startsWith("Dummy")) return "dummy";
  return undefined;
}

function buildCompat(choice: string): Record<string, boolean> | undefined {
  if (choice.startsWith("Disable developer role + reasoning_effort")) {
    return { supportsDeveloperRole: false, supportsReasoningEffort: false };
  }
  if (choice.startsWith("Disable developer role")) return { supportsDeveloperRole: false };
  return undefined;
}

async function readModelsJson(): Promise<ModelsJson> {
  try {
    const raw = await readFile(MODELS_PATH, "utf8");
    const parsed = JSON.parse(raw) as ModelsJson;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("models.json root must be an object");
    if (parsed.providers && (typeof parsed.providers !== "object" || Array.isArray(parsed.providers))) {
      throw new Error("models.json providers must be an object");
    }
    return parsed;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { providers: {} };
    throw error;
  }
}

function mergeProvider(existing: ModelsJson, providerId: string, provider: ProviderConfig): ModelsJson {
  const providers = { ...(existing.providers ?? {}) };
  const previous = providers[providerId];
  providers[providerId] = previous ? { ...previous, ...provider, models: provider.models } : provider;
  return { ...existing, providers };
}

async function inputRequired(ctx: ExtensionCommandContext, label: string, placeholder: string): Promise<string | undefined> {
  const value = await ctx.ui.input(label, placeholder);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export async function runModelRelayWizard(ctx: ExtensionCommandContext, initialArgs: string) {
  const suggestedId = normalizeProviderId(initialArgs) || "my-relay";
  const providerIdInput = await inputRequired(ctx, "Provider id", suggestedId);
  if (!providerIdInput) return;

  const providerId = normalizeProviderId(providerIdInput);
  if (!providerId) {
    ctx.ui.notify("Provider id is empty after normalization", "error");
    return;
  }

  const baseUrl = await inputRequired(ctx, "Base URL", "https://example.com/v1");
  if (!baseUrl) return;

  const api = await ctx.ui.select("API type", API_TYPES);
  if (!api) return;

  const authChoice = await ctx.ui.select("API key source", [
    "Keychain command in models.json",
    "Environment variable in models.json",
    "Dummy literal key",
    "Omit apiKey (/login, auth.json, or --api-key)",
  ]);
  if (!authChoice) return;

  let authDetail = "";
  if (authChoice.startsWith("Keychain")) {
    authDetail = (await ctx.ui.input("Keychain service name", `pi-model-api-key-${providerId}`))?.trim() ?? "";
  } else if (authChoice.startsWith("Environment")) {
    authDetail = (await ctx.ui.input("Environment variable name", `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`))?.trim() ?? "";
  }

  const modelIdsRaw = await ctx.ui.editor("Model ids, comma or newline separated", "gpt-4.1\nclaude-sonnet-4-5");
  if (!modelIdsRaw) return;
  const modelIds = parseModelIds(modelIdsRaw);
  if (modelIds.length === 0) {
    ctx.ui.notify("No model ids provided", "error");
    return;
  }

  const inputMode = await ctx.ui.select("Input support", ["text", "text,image"] satisfies InputMode[]);
  if (!inputMode) return;

  const reasoning = await ctx.ui.confirm("Reasoning", "Mark these models as reasoning-capable?");
  const contextWindow = parsePositiveInt(await ctx.ui.input("Context window tokens", "128000"));
  const maxTokens = parsePositiveInt(await ctx.ui.input("Max output tokens", "16384"));

  const compatChoice = await ctx.ui.select("Compatibility", [
    "No compat override",
    "Disable developer role",
    "Disable developer role + reasoning_effort",
  ]);
  if (!compatChoice) return;

  const compat = buildCompat(compatChoice);
  const modelBase: Omit<ModelConfig, "id"> = {
    reasoning,
    input: inputMode.split(","),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  };

  const provider: ProviderConfig = {
    baseUrl,
    api,
    ...(buildApiKeyRef(providerId, authChoice, authDetail) ? { apiKey: buildApiKeyRef(providerId, authChoice, authDetail) } : {}),
    ...(compat ? { compat } : {}),
    models: modelIds.map((id) => ({ id, ...modelBase })),
  };

  let nextModels: ModelsJson;
  try {
    const existing = await readModelsJson();
    nextModels = mergeProvider(existing, providerId, provider);
  } catch (error) {
    ctx.ui.notify(`Cannot read ${MODELS_PATH}: ${(error as Error).message}`, "error");
    return;
  }

  const preview = JSON.stringify(nextModels, null, 2) + "\n";
  const edited = await ctx.ui.editor(`Review ${MODELS_PATH}`, preview);
  if (!edited) return;

  let parsedEdited: ModelsJson;
  try {
    parsedEdited = JSON.parse(edited) as ModelsJson;
  } catch (error) {
    ctx.ui.notify(`Invalid JSON: ${(error as Error).message}`, "error");
    return;
  }

  const ok = await ctx.ui.confirm("Write models.json?", `Write configuration to ${MODELS_PATH}?`);
  if (!ok) return;

  await mkdir(dirname(MODELS_PATH), { recursive: true });
  await writeFile(MODELS_PATH, JSON.stringify(parsedEdited, null, 2) + "\n", "utf8");

  let message = `Added provider ${providerId}. Open /model to verify.`;
  if (authChoice.startsWith("Keychain")) {
    const service = authDetail || `pi-model-api-key-${providerId}`;
    message += ` Keychain service: ${service}.`;
  }
  ctx.ui.notify(message, "info");
}

export default function (pi: ExtensionAPI) {
  const command = {
    description: "Add or update a local pi model relay/provider in ~/.pi/agent/models.json",
    handler: async (args: string, ctx: ExtensionCommandContext) => runModelRelayWizard(ctx, args),
  };

  pi.registerCommand("model-relay-add", command);
}
