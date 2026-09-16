import type { ModelConfig, ModelRef, ModelRole, ResolvedModel, TaskStatus } from "./schemas.ts";

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["blocked", "needs_review", "succeeded", "failed", "cancelled"],
  blocked: ["running", "cancelled", "failed"],
  needs_review: ["running", "succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid model task status transition: ${from} -> ${to}`);
  }
}

type ConfigSource = "global" | "project" | "task";

export type ModelConfigLayers = {
  global?: ModelConfig;
  project?: ModelConfig;
  task?: ModelConfig;
};

export function resolveModel(role: ModelRole, layers: ModelConfigLayers): ResolvedModel | undefined {
  const precedence: Array<[ConfigSource, ModelConfig | undefined]> = [
    ["task", layers.task],
    ["project", layers.project],
    ["global", layers.global],
  ];
  for (const [source, config] of precedence) {
    const selected = config?.[role] as ModelRef | undefined;
    if (selected) return { ...selected, role, source };
  }
  return undefined;
}

export function fallbackModels(model: ResolvedModel): Array<ResolvedModel> {
  return (model.fallbacks ?? []).map((fallback) => ({
    ...fallback,
    role: model.role,
    source: model.source,
  }));
}
