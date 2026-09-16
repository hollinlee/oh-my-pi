import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { assertTransition, fallbackModels, resolveModel, type ModelConfigLayers } from "./state.ts";
import {
  MODEL_TASK_SCHEMA_VERSION,
  type ResolvedModel,
  type TaskCheckpoint,
  type TaskEvent,
  type TaskResult,
  type TaskSpec,
  type TaskStatus,
} from "./schemas.ts";
import { TaskCheckpointStore } from "./store.ts";
import { runSubagent, type ActiveDispatch } from "../subagent/runtime.ts";
import type { SubagentDetails, SubagentTask } from "../subagent/schemas.ts";

export type ExecutionUpdate = {
  phase: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type ExecutionOutcome = {
  status: "succeeded" | "blocked" | "needs_review" | "failed" | "cancelled" | "retryable";
  result: TaskResult;
};

export type ExecutionAdapter<Model = unknown> = (input: {
  task: TaskSpec;
  model: Model;
  signal?: AbortSignal;
  onUpdate: (update: ExecutionUpdate) => void;
}) => Promise<ExecutionOutcome>;

export type ModelResolver<Model = unknown> = (model: ResolvedModel) => Model | undefined;

const activeRuns = new Map<string, Promise<TaskCheckpoint>>();

function serializeRun(key: string, operation: () => Promise<TaskCheckpoint>): Promise<TaskCheckpoint> {
  const active = activeRuns.get(key);
  if (active) return active;
  const current = operation().finally(() => {
    if (activeRuns.get(key) === current) activeRuns.delete(key);
  });
  activeRuns.set(key, current);
  return current;
}

function event(kind: TaskEvent["kind"], summary: string, details?: Record<string, unknown>): TaskEvent {
  return { id: randomUUID(), at: new Date().toISOString(), kind, summary, ...(details ? { details } : {}) };
}

function emptyResult(summary: string, unresolved: string[] = []): TaskResult {
  return { summary, models: [], changes: [], verification: [], risks: [], unresolved, nextActions: [] };
}

export class ModelTaskHarness<Model = unknown> {
  private readonly store: TaskCheckpointStore;
  private readonly resolveRuntimeModel: ModelResolver<Model>;
  private readonly execute: ExecutionAdapter<Model>;

  constructor(
    store: TaskCheckpointStore,
    resolveRuntimeModel: ModelResolver<Model>,
    execute: ExecutionAdapter<Model>,
  ) {
    this.store = store;
    this.resolveRuntimeModel = resolveRuntimeModel;
    this.execute = execute;
  }

  run(task: TaskSpec, layers: Omit<ModelConfigLayers, "task"> = {}, signal?: AbortSignal): Promise<TaskCheckpoint> {
    return serializeRun(`${this.store.root}:${task.id}`, () => this.runExclusive(task, layers, signal));
  }

  private async runExclusive(task: TaskSpec, layers: Omit<ModelConfigLayers, "task"> = {}, signal?: AbortSignal): Promise<TaskCheckpoint> {
    const existing = await this.store.load(task.id);
    if (existing && !isDeepStrictEqual(existing.task, task)) {
      throw new Error(`Model task definition mismatch for existing task id: ${task.id}`);
    }
    if (existing && ["succeeded", "failed", "cancelled", "needs_review"].includes(existing.status)) return existing;
    if (existing?.status === "running" && existing.events.at(-1)?.details?.idempotent === false) {
      return this.persist(existing, "needs_review", "recovery", {
        ...emptyResult("Recovery requires review", ["The last operation may have produced side effects"]),
      }, event("escalation", "Non-idempotent operation was interrupted; automatic replay blocked"));
    }

    let checkpoint = existing ?? {
      schemaVersion: MODEL_TASK_SCHEMA_VERSION,
      revision: 0,
      task,
      status: "queued" as const,
      phase: "queued",
      updatedAt: new Date().toISOString(),
      events: [event("status", "Task queued")],
    };
    if (!existing) await this.store.save(checkpoint);
    if (checkpoint.status !== "running") {
      checkpoint = await this.persist(checkpoint, "running", "execution", undefined, event("status", "Task execution started"));
    }

    const selected = resolveModel("execution", { ...layers, task: task.modelConfig });
    if (!selected) {
      return this.persist(checkpoint, "blocked", "model-resolution", emptyResult("No execution model configured", ["Configure an execution model"]), event("status", "No execution model configured"));
    }

    const candidates = [selected, ...fallbackModels(selected)];
    const attempted = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.provider}/${candidate.model}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      const runtimeModel = this.resolveRuntimeModel(candidate);
      if (!runtimeModel) {
        checkpoint = await this.append(checkpoint, event("model", `Execution model unavailable: ${key}`, { role: candidate.role, source: candidate.source }));
        continue;
      }
      checkpoint = await this.activateModel(checkpoint, candidate);
      let updateQueue = Promise.resolve();
      try {
        const outcome = await this.execute({
          task,
          model: runtimeModel,
          signal,
          onUpdate: (update) => {
            updateQueue = updateQueue.then(async () => {
              checkpoint = await this.append(checkpoint, event("phase", update.summary, { phase: update.phase, ...update.details }));
            });
          },
        });
        await updateQueue;
        const result = { ...outcome.result, models: [...outcome.result.models, candidate] };
        if (outcome.status === "retryable") {
          checkpoint = await this.append(checkpoint, event("model", `Execution model failed before tool execution: ${key}`));
          continue;
        }
        return this.persist(checkpoint, outcome.status, "completed", result, event("report", result.summary));
      } catch (error) {
        await updateQueue;
        checkpoint = await this.append(checkpoint, event("model", `Execution stopped with uncertain side effects: ${key}`, { error: (error as Error).message }));
        return this.persist(
          checkpoint,
          "needs_review",
          "recovery",
          emptyResult("Execution failed after dispatch; automatic fallback blocked", [(error as Error).message]),
          event("escalation", "Execution side effects are unknown; review required before retry"),
        );
      }
    }
    return this.persist(checkpoint, "blocked", "model-resolution", emptyResult("All configured execution models failed", [...attempted]), event("status", "Execution model fallback exhausted"));
  }

  private async activateModel(checkpoint: TaskCheckpoint, model: ResolvedModel): Promise<TaskCheckpoint> {
    const next = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
      updatedAt: new Date().toISOString(),
      activeModel: model,
      events: [...checkpoint.events, event("model", `Using ${model.model}`, { provider: model.provider, role: model.role, source: model.source })],
    };
    await this.store.save(next, checkpoint.revision);
    return next;
  }

  private async append(checkpoint: TaskCheckpoint, item: TaskEvent): Promise<TaskCheckpoint> {
    const latest = await this.store.load(checkpoint.task.id) ?? checkpoint;
    const next = { ...latest, revision: latest.revision + 1, updatedAt: new Date().toISOString(), events: [...latest.events, item] };
    await this.store.save(next, latest.revision);
    return next;
  }

  private async persist(checkpoint: TaskCheckpoint, status: TaskStatus, phase: string, result?: TaskResult, item?: TaskEvent): Promise<TaskCheckpoint> {
    if (checkpoint.status !== status) assertTransition(checkpoint.status, status);
    const next: TaskCheckpoint = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
      status,
      phase,
      updatedAt: new Date().toISOString(),
      events: item ? [...checkpoint.events, item] : checkpoint.events,
      ...(result ? { result } : {}),
    };
    await this.store.save(next, checkpoint.revision);
    return next;
  }
}

function mapSubagent(details: SubagentDetails): ExecutionOutcome {
  const result = details.result;
  const status: ExecutionOutcome["status"] = result?.status === "completed"
    ? "succeeded"
    : result?.status === "needs-context"
      ? "needs_review"
      : result?.status === "cancelled"
        ? "cancelled"
        : (result?.status === "model-error" || result?.status === "runtime-error") && details.usage.toolCalls === 0
          ? "retryable"
          : result?.status === "model-error" || result?.status === "runtime-error"
            ? "needs_review"
            : "failed";
  return {
    status,
    result: {
      summary: result?.summary ?? details.stopReason ?? "Execution ended without a result",
      models: [],
      changes: result?.changes ?? [],
      verification: (result?.verification ?? []).map((item) => ({ command: item.command ?? "not reported", outcome: item.outcome })),
      risks: result?.risks ?? [],
      unresolved: result?.remainingWork ?? [],
      nextActions: result?.questions ?? [],
      finalReport: result?.summary,
    },
  };
}

export function createSubagentExecutionAdapter(
  ctx: ExtensionContext,
  registerActive: (dispatch: ActiveDispatch) => () => void,
): ExecutionAdapter<NonNullable<ExtensionContext["model"]>> {
  return async ({ task, model, signal, onUpdate }) => {
    const subagentTask: SubagentTask = {
      id: task.id,
      objective: task.goal,
      acceptanceCriteria: task.acceptanceCriteria,
      context: task.context,
      scope: task.scope,
      capability: { profile: "workspace-write" },
      budget: "standard",
      constraints: task.constraints,
      nonGoals: ["Do not commit, push, deploy, or modify permissions"],
      expectedOutput: "Return structured changes, verification, risks, remaining work, and questions.",
    };
    const details = await runSubagent(
      subagentTask,
      "standard",
      ctx,
      signal,
      (update) => onUpdate({ phase: update.status, summary: update.lastActivity ?? update.status, details: { usage: update.usage } }),
      registerActive,
      model,
    );
    return mapSubagent(details);
  };
}
