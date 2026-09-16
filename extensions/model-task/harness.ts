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
import {
  collaborationEventDetails,
  correctionContext,
  escalationReasons,
  minimalEscalationRequest,
  requiresMandatoryReview,
  type CollaborationAdapter,
  type CollaborationResponse,
} from "./collaboration.ts";

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
  private readonly observe?: (checkpoint: TaskCheckpoint) => void;
  private readonly collaborate?: CollaborationAdapter<Model>;

  constructor(
    store: TaskCheckpointStore,
    resolveRuntimeModel: ModelResolver<Model>,
    execute: ExecutionAdapter<Model>,
    observe?: (checkpoint: TaskCheckpoint) => void,
    collaborate?: CollaborationAdapter<Model>,
  ) {
    this.store = store;
    this.resolveRuntimeModel = resolveRuntimeModel;
    this.execute = execute;
    this.observe = observe;
    this.collaborate = collaborate;
  }

  private observeBestEffort(checkpoint: TaskCheckpoint): void {
    try {
      this.observe?.(checkpoint);
    } catch {
      // Observation is a display projection; durable checkpoint execution must continue.
    }
  }

  run(task: TaskSpec, layers: Omit<ModelConfigLayers, "task"> = {}, signal?: AbortSignal): Promise<TaskCheckpoint> {
    return serializeRun(`${this.store.root}:${task.id}`, () => this.runExclusive(task, layers, signal));
  }

  private async runExclusive(task: TaskSpec, layers: Omit<ModelConfigLayers, "task"> = {}, signal?: AbortSignal): Promise<TaskCheckpoint> {
    const existing = await this.store.load(task.id);
    if (existing && !isDeepStrictEqual(existing.task, task)) {
      throw new Error(`Model task definition mismatch for existing task id: ${task.id}`);
    }
    if (existing && ["succeeded", "failed", "cancelled", "needs_review"].includes(existing.status)) {
      this.observeBestEffort(existing);
      return existing;
    }
    if (existing?.status === "running" && existing.events.some((item) => item.details?.idempotent === false)) {
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
    if (!existing) {
      await this.store.save(checkpoint);
      this.observeBestEffort(checkpoint);
    }
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
      let dispatched = await this.dispatch(checkpoint, task, runtimeModel, signal);
      checkpoint = dispatched.checkpoint;
      if (dispatched.error) {
        checkpoint = await this.append(checkpoint, event("model", `Execution stopped with uncertain side effects: ${key}`, { error: dispatched.error.message }));
        return this.persist(
          checkpoint,
          "needs_review",
          "recovery",
          emptyResult("Execution failed after dispatch; automatic fallback blocked", [dispatched.error.message]),
          event("escalation", "Execution side effects are unknown; review required before retry"),
        );
      }
      if (dispatched.outcome!.status === "retryable") {
        checkpoint = await this.append(checkpoint, event("model", `Execution model failed before tool execution: ${key}`));
        continue;
      }

      let outcome = dispatched.outcome!;
      let result: TaskResult = { ...outcome.result, models: [...outcome.result.models, candidate] };
      const reasons = escalationReasons(task, outcome.status, result);
      if (reasons.length > 0) {
        const request = minimalEscalationRequest(task, outcome.status, result, reasons);
        const consultation = await this.consult(checkpoint, "advice", task, layers, request, signal);
        checkpoint = consultation.checkpoint;
        if (!consultation.response || !consultation.runtimeModel || !consultation.resolvedModel) {
          return this.persist(checkpoint, "needs_review", "escalation", result, event("report", "Advanced-model escalation is required but unavailable"));
        }
        if (consultation.response.disposition === "stop" || consultation.response.disposition === "changes_required") {
          return this.persist(checkpoint, "needs_review", "escalation", {
            ...result,
            unresolved: [...result.unresolved, ...consultation.response.nextActions],
          }, event("report", consultation.response.summary));
        }
        const takeover = consultation.response.disposition === "takeover";
        const correctionModel = takeover ? consultation.runtimeModel : runtimeModel;
        const correctionResolved = takeover ? consultation.resolvedModel : candidate;
        if (takeover) {
          checkpoint = await this.activateModel(checkpoint, consultation.resolvedModel);
          checkpoint = await this.append(checkpoint, event("model", `Advanced model temporarily took over: ${consultation.response.takeoverReason ?? consultation.response.summary}`, { role: "decision", samePolicyBoundary: true }));
        }
        const correctedTask: TaskSpec = { ...task, context: [...task.context, correctionContext(consultation.response)] };
        dispatched = await this.dispatch(checkpoint, correctedTask, correctionModel, signal);
        checkpoint = dispatched.checkpoint;
        if (dispatched.error || dispatched.outcome?.status === "retryable") {
          const reason = dispatched.error?.message ?? "Corrective execution failed before completion";
          return this.persist(checkpoint, "needs_review", "escalation", {
            ...result,
            unresolved: [...result.unresolved, reason],
          }, event("report", "Corrective execution stopped; no further automatic calls"));
        }
        outcome = dispatched.outcome!;
        result = { ...outcome.result, models: [...result.models, ...outcome.result.models, correctionResolved] };
      }

      if (outcome.status === "succeeded" && requiresMandatoryReview(task, result)) {
        const request = minimalEscalationRequest(task, outcome.status, result, escalationReasons(task, outcome.status, result));
        const review = await this.consult(checkpoint, "review", task, layers, request, signal);
        checkpoint = review.checkpoint;
        if (!review.response || review.response.disposition !== "approve") {
          return this.persist(checkpoint, "needs_review", "review", {
            ...result,
            unresolved: [...result.unresolved, ...(review.response?.nextActions ?? ["Mandatory review model is unavailable"])],
          }, event("report", review.response?.summary ?? "Mandatory review could not be completed"));
        }
        result = { ...result, models: [...result.models, review.resolvedModel!] };
      }
      return this.persist(checkpoint, outcome.status, "completed", result, event("report", result.summary));
    }
    return this.persist(checkpoint, "blocked", "model-resolution", emptyResult("All configured execution models failed", [...attempted]), event("status", "Execution model fallback exhausted"));
  }

  private async dispatch(checkpoint: TaskCheckpoint, task: TaskSpec, model: Model, signal?: AbortSignal): Promise<{ checkpoint: TaskCheckpoint; outcome?: ExecutionOutcome; error?: Error }> {
    let current = checkpoint;
    let updateQueue = Promise.resolve();
    let outcome: ExecutionOutcome | undefined;
    let executionError: Error | undefined;
    try {
      outcome = await this.execute({
        task,
        model,
        signal,
        onUpdate: (update) => {
          updateQueue = updateQueue.then(async () => {
            current = await this.append(current, event("phase", update.summary, { phase: update.phase, ...update.details }));
          });
        },
      });
    } catch (error) {
      executionError = error instanceof Error ? error : new Error(String(error));
    }
    await updateQueue;
    return { checkpoint: current, ...(outcome ? { outcome } : {}), ...(executionError ? { error: executionError } : {}) };
  }

  private async consult(
    checkpoint: TaskCheckpoint,
    kind: "advice" | "review",
    task: TaskSpec,
    layers: Omit<ModelConfigLayers, "task">,
    request: ReturnType<typeof minimalEscalationRequest>,
    signal?: AbortSignal,
  ): Promise<{ checkpoint: TaskCheckpoint; response?: CollaborationResponse; runtimeModel?: Model; resolvedModel?: ResolvedModel }> {
    const role = kind === "advice" ? "decision" : "review";
    const resolvedModel = resolveModel(role, { ...layers, task: task.modelConfig });
    let current = await this.append(checkpoint, event(kind === "advice" ? "escalation" : "review", `${kind === "advice" ? "Advanced advice" : "Mandatory review"} requested`, collaborationEventDetails(request)));
    if (!this.collaborate || !resolvedModel) return { checkpoint: current };
    const runtimeModel = this.resolveRuntimeModel(resolvedModel);
    if (!runtimeModel) {
      current = await this.append(current, event("model", `${role} model unavailable: ${resolvedModel.provider}/${resolvedModel.model}`, { role, source: resolvedModel.source }));
      return { checkpoint: current };
    }
    let response: CollaborationResponse;
    try {
      response = await this.collaborate({ kind, task, model: runtimeModel, resolvedModel, request, signal });
    } catch (error) {
      current = await this.append(current, event(kind === "advice" ? "escalation" : "review", `${role} model failed: ${(error as Error).message}`));
      return { checkpoint: current };
    }
    current = await this.append(current, event(kind === "advice" ? "escalation" : "review", response.summary, collaborationEventDetails(request, response)));
    return { checkpoint: current, response, runtimeModel, resolvedModel };
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
    this.observeBestEffort(next);
    return next;
  }

  private async append(checkpoint: TaskCheckpoint, item: TaskEvent): Promise<TaskCheckpoint> {
    const latest = await this.store.load(checkpoint.task.id) ?? checkpoint;
    const phase = item.kind === "phase" && typeof item.details?.phase === "string" ? item.details.phase : latest.phase;
    const next = { ...latest, phase, revision: latest.revision + 1, updatedAt: new Date().toISOString(), events: [...latest.events, item] };
    await this.store.save(next, latest.revision);
    this.observeBestEffort(next);
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
    this.observeBestEffort(next);
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

export function createSubagentCollaborationAdapter(
  ctx: ExtensionContext,
  registerActive: (dispatch: ActiveDispatch) => () => void,
): CollaborationAdapter<NonNullable<ExtensionContext["model"]>> {
  return async ({ kind, task, model, request, signal }) => {
    const collaboratorTask: SubagentTask = {
      id: `${task.id.slice(0, 65)}-${kind}`,
      objective: kind === "advice"
        ? "Return a minimal corrective plan. Do not edit files. Use [TAKEOVER] only when the execution model cannot safely apply the correction."
        : "Review the supplied evidence. Approve only when acceptance criteria and safety requirements are satisfied. Do not edit files.",
      acceptanceCriteria: kind === "advice" ? ["Provide bounded corrective actions and evidence"] : ["Identify approval or required changes with evidence"],
      context: [JSON.stringify(request)],
      scope: task.scope,
      capability: { profile: "read-only" },
      budget: "small",
      constraints: ["Do not request broader permissions", "Do not include secrets or full transcripts", ...task.constraints],
      nonGoals: ["Do not modify files", "Do not commit, push, deploy, or access the network"],
      expectedOutput: "Return a concise summary, evidence, risks, remaining work, and next actions.",
    };
    const details = await runSubagent(collaboratorTask, "small", ctx, signal, () => {}, registerActive, model);
    const result = details.result;
    const summary = result?.summary ?? details.stopReason ?? `${kind} model returned no summary`;
    const nextActions = result?.questions ?? result?.remainingWork ?? [];
    const takeover = kind === "advice" && /\[TAKEOVER\]/i.test(summary);
    const approved = kind === "review" && result?.status === "completed" && (result.risks?.length ?? 0) === 0 && (result.remainingWork?.length ?? 0) === 0;
    return {
      disposition: kind === "review" ? (approved ? "approve" : "changes_required") : takeover ? "takeover" : result?.status === "completed" ? "correct" : "stop",
      summary,
      plan: nextActions,
      evidence: (result?.evidence ?? []).map((item) => ({ claim: item.claim, source: item.source })),
      nextActions,
      ...(takeover ? { takeoverReason: summary } : {}),
    };
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
