import path from "node:path";
import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { SubagentTaskSchema, type SubagentDetails, type SubagentTask, type SubagentUsage } from "./schemas.ts";

export const MAX_DAG_NODES = 8;
export const MAX_DAG_DEPTH = 3;
export const MAX_DAG_CONCURRENCY = 3;
export const DAG_ABORT_GRACE_MS = 500;

export const BatchBudgetSchema = StringEnum(["small", "standard", "large"] as const);
export type BatchBudgetName = Static<typeof BatchBudgetSchema>;

export const BATCH_BUDGETS: Record<BatchBudgetName, { turns: number; toolCalls: number; wallTimeMs: number }> = {
  small: { turns: 12, toolCalls: 24, wallTimeMs: 5 * 60_000 },
  standard: { turns: 30, toolCalls: 80, wallTimeMs: 20 * 60_000 },
  large: { turns: 60, toolCalls: 200, wallTimeMs: 60 * 60_000 },
};

export const SubagentDagSchema = Type.Object({
  batchId: Type.String({ minLength: 1, maxLength: 80 }),
  nodes: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 80 }),
    task: Type.Omit(SubagentTaskSchema, ["id"]),
    dependencies: Type.Array(Type.String()),
  }), { minItems: 1, maxItems: MAX_DAG_NODES }),
  concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_DAG_CONCURRENCY })),
  budget: Type.Optional(BatchBudgetSchema),
});
export type SubagentDagInput = Static<typeof SubagentDagSchema>;
export type SubagentDag = Omit<SubagentDagInput, "nodes"> & {
  nodes: Array<Omit<SubagentDagInput["nodes"][number], "task"> & { task: SubagentTask }>;
};

export function createSubagentDag(input: SubagentDagInput): SubagentDag {
  return {
    ...input,
    nodes: input.nodes.map((node) => ({
      ...node,
      task: { ...node.task, id: node.id },
    })),
  };
}

export type DagNodeStatus = SubagentDetails["status"] | "pending" | "blocked";
export type DagNodeResult = {
  id: string;
  dependencies: string[];
  status: DagNodeStatus;
  blockedReason?: string;
  details?: SubagentDetails;
};
export type DagResult = {
  batchId: string;
  status: "completed" | "partial" | "budget-exhausted" | "cancelled" | "invalid" | "preflight-blocked";
  budget: BatchBudgetName;
  usage: SubagentUsage;
  nodes: DagNodeResult[];
  errors: string[];
};

export type DagRunner = (
  task: SubagentTask,
  signal: AbortSignal,
  onUpdate: (details: SubagentDetails) => void,
) => Promise<SubagentDetails>;

export type DagRuntimeOptions = {
  abortGraceMs?: number;
  wallTimeMs?: number;
};

function dependencyDepth(id: string, nodes: Map<string, SubagentDag["nodes"][number]>, memo = new Map<string, number>(), visiting = new Set<string>()): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  if (visiting.has(id)) throw new Error(`DAG cycle detected at ${id}`);
  visiting.add(id);
  const node = nodes.get(id)!;
  const depth = node.dependencies.length === 0 ? 1 : 1 + Math.max(...node.dependencies.map((dep) => dependencyDepth(dep, nodes, memo, visiting)));
  visiting.delete(id);
  memo.set(id, depth);
  return depth;
}

function reaches(from: string, target: string, nodes: Map<string, SubagentDag["nodes"][number]>, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return nodes.get(from)?.dependencies.some((dep) => reaches(dep, target, nodes, seen)) ?? false;
}

function taskRoots(task: SubagentTask): string[] {
  const cwd = path.resolve(task.scope.cwd || process.cwd());
  return (task.scope.includePaths?.length ? task.scope.includePaths : ["."]).map((entry) => path.resolve(cwd, entry));
}

function overlaps(a: string, b: string): boolean {
  const relA = path.relative(a, b);
  const relB = path.relative(b, a);
  return relA === "" || (!relA.startsWith("..") && !path.isAbsolute(relA)) || (!relB.startsWith("..") && !path.isAbsolute(relB));
}

export function validateDag(dag: SubagentDag): string[] {
  const errors: string[] = [];
  if (dag.nodes.length > MAX_DAG_NODES) errors.push(`DAG has more than ${MAX_DAG_NODES} nodes`);
  const map = new Map<string, SubagentDag["nodes"][number]>();
  for (const node of dag.nodes) {
    if (map.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    map.set(node.id, node);
    if (node.task.id !== node.id) errors.push(`node ${node.id} task.id must match node id`);
    const overrides = node.task.capability.overrides ?? [];
    if (node.task.capability.profile === "elevated" && overrides.length === 0) errors.push(`node ${node.id} elevated profile requires explicit overrides`);
    if (node.task.capability.profile !== "elevated" && overrides.length > 0) errors.push(`node ${node.id} capability overrides require elevated profile`);
  }
  for (const node of dag.nodes) {
    for (const dependency of node.dependencies) if (!map.has(dependency)) errors.push(`node ${node.id} has missing dependency: ${dependency}`);
  }
  if (errors.length > 0) return errors;
  try {
    for (const node of dag.nodes) {
      const depth = dependencyDepth(node.id, map);
      if (depth > MAX_DAG_DEPTH) errors.push(`node ${node.id} exceeds max DAG depth ${MAX_DAG_DEPTH}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const writeNodes = dag.nodes.filter((node) => node.task.capability.profile !== "read-only");
  for (let i = 0; i < writeNodes.length; i++) {
    for (let j = i + 1; j < writeNodes.length; j++) {
      const a = writeNodes[i];
      const b = writeNodes[j];
      const ordered = reaches(a.id, b.id, map) || reaches(b.id, a.id, map);
      if (ordered) continue;
      if (taskRoots(a.task).some((rootA) => taskRoots(b.task).some((rootB) => overlaps(rootA, rootB)))) {
        errors.push(`write nodes ${a.id} and ${b.id} have overlapping scope without dependency ordering`);
      }
    }
  }
  return errors;
}

function sumUsage(values: Iterable<SubagentUsage>, startedAt: number): SubagentUsage {
  let turns = 0;
  let toolCalls = 0;
  let toolOutputBytes = 0;
  let tokens = 0;
  let cost = 0;
  let hasTokens = false;
  let hasCost = false;
  for (const usage of values) {
    turns += usage.turns;
    toolCalls += usage.toolCalls;
    toolOutputBytes += usage.toolOutputBytes ?? 0;
    if (usage.tokens !== undefined) { tokens += usage.tokens; hasTokens = true; }
    if (usage.cost !== undefined) { cost += usage.cost; hasCost = true; }
  }
  return { turns, toolCalls, toolOutputBytes, elapsedMs: Date.now() - startedAt, tokens: hasTokens ? tokens : undefined, cost: hasCost ? cost : undefined };
}

export async function runDag(
  dag: SubagentDag,
  parentSignal: AbortSignal | undefined,
  runner: DagRunner,
  onUpdate?: (result: DagResult) => void,
  options: DagRuntimeOptions = {},
): Promise<DagResult> {
  const errors = validateDag(dag);
  const budgetName = dag.budget ?? "standard";
  const budget = BATCH_BUDGETS[budgetName];
  const wallTimeMs = options.wallTimeMs ?? budget.wallTimeMs;
  const abortGraceMs = options.abortGraceMs ?? DAG_ABORT_GRACE_MS;
  const startedAt = Date.now();
  const states = new Map<string, DagNodeResult>(dag.nodes.map((node) => [node.id, { id: node.id, dependencies: [...node.dependencies], status: "pending" }]));
  const usage = new Map<string, SubagentUsage>();
  const controller = new AbortController();
  let batchStop: "budget-exhausted" | "cancelled" | undefined;
  let releaseStop: () => void = () => {};
  const stopWait = new Promise<void>((resolve) => { releaseStop = resolve; });
  const abort = (reason: typeof batchStop) => {
    if (batchStop) return;
    batchStop = reason;
    controller.abort();
    releaseStop();
  };
  const onParentAbort = () => abort("cancelled");
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => abort("budget-exhausted"), wallTimeMs);
  const snapshot = (): DagResult => ({
    batchId: dag.batchId,
    status: errors.length > 0 ? "invalid" : batchStop ?? (states.size > 0 && [...states.values()].every((node) => node.status === "completed") ? "completed" : "partial"),
    budget: budgetName,
    usage: sumUsage(usage.values(), startedAt),
    nodes: dag.nodes.map((node) => states.get(node.id)!),
    errors: [...errors],
  });
  const publish = () => onUpdate?.(snapshot());
  const checkBudget = () => {
    const total = sumUsage(usage.values(), startedAt);
    if (total.turns >= budget.turns || total.toolCalls >= budget.toolCalls || total.elapsedMs >= wallTimeMs) abort("budget-exhausted");
  };

  try {
    if (errors.length > 0) return snapshot();
    const concurrency = Math.min(dag.concurrency ?? MAX_DAG_CONCURRENCY, MAX_DAG_CONCURRENCY);
    while ([...states.values()].some((node) => node.status === "pending")) {
      if (batchStop) break;
      let changed = false;
      for (const node of dag.nodes) {
        const state = states.get(node.id)!;
        if (state.status !== "pending") continue;
        const failedDependency = node.dependencies.map((id) => states.get(id)!).find((dep) => dep.status !== "pending" && dep.status !== "running" && dep.status !== "completed");
        if (failedDependency) {
          state.status = "blocked";
          state.blockedReason = `dependency ${failedDependency.id} ended with ${failedDependency.status}`;
          changed = true;
        }
      }
      const runnable = dag.nodes.filter((node) => {
        const state = states.get(node.id)!;
        return state.status === "pending" && node.dependencies.every((id) => states.get(id)!.status === "completed");
      });
      if (runnable.length === 0) {
        if (!changed) break;
        publish();
        continue;
      }
      for (let offset = 0; offset < runnable.length && !batchStop; offset += concurrency) {
        const wave = runnable.slice(offset, offset + concurrency);
        let acceptingResults = true;
        const executions = wave.map(async (node) => {
          const state = states.get(node.id)!;
          state.status = "running";
          publish();
          try {
            const details = await runner(node.task, controller.signal, (partial) => {
              if (!acceptingResults) return;
              state.details = partial;
              state.status = partial.status;
              usage.set(node.id, partial.usage);
              checkBudget();
              publish();
            });
            if (!acceptingResults) return;
            state.details = details;
            state.status = details.status;
            usage.set(node.id, details.usage);
          } catch (error) {
            if (!acceptingResults) return;
            const message = error instanceof Error ? error.message : String(error);
            const nodeUsage = usage.get(node.id) ?? { turns: 0, toolCalls: 0, elapsedMs: Date.now() - startedAt };
            state.details = {
              task: node.task,
              status: "runtime-error",
              budget: node.task.budget ?? "small",
              usage: nodeUsage,
              events: [],
              stopReason: message,
              result: {
                taskId: node.id,
                status: "runtime-error",
                summary: message,
                evidence: [],
                changes: [],
                verification: [],
                risks: [message],
                remainingWork: ["Retry or inspect the failed node runtime."],
                questions: [],
                usage: nodeUsage,
              },
            };
            state.status = "runtime-error";
            usage.set(node.id, nodeUsage);
          }
          if (!acceptingResults) return;
          checkBudget();
          publish();
        });
        const settled = Promise.allSettled(executions).then(() => true);
        const forcedStop = stopWait.then(() => new Promise<false>((resolve) => {
          setTimeout(() => resolve(false), abortGraceMs);
        }));
        if (!await Promise.race([settled, forcedStop])) {
          acceptingResults = false;
          const terminalStatus = batchStop === "cancelled" ? "cancelled" : "budget-exhausted";
          const reason = `batch ${batchStop}; runner did not settle within ${abortGraceMs}ms abort grace`;
          for (const node of wave) {
            const state = states.get(node.id)!;
            if (state.status !== "running" && state.status !== "starting") continue;
            const nodeUsage = usage.get(node.id) ?? state.details?.usage ?? { turns: 0, toolCalls: 0, elapsedMs: Date.now() - startedAt };
            state.details = {
              task: node.task,
              status: terminalStatus,
              budget: node.task.budget ?? "small",
              usage: nodeUsage,
              events: [...(state.details?.events ?? []), { at: Date.now(), kind: "status", text: reason }],
              stopReason: reason,
              transcriptPath: state.details?.transcriptPath,
              result: {
                taskId: node.id,
                status: terminalStatus,
                summary: reason,
                evidence: [],
                changes: [],
                verification: [],
                risks: ["The child runtime may not have acknowledged cancellation before the scheduler returned."],
                remainingWork: ["Retry as a smaller subagent task and inspect the child transcript if needed."],
                questions: [],
                usage: nodeUsage,
                transcriptPath: state.details?.transcriptPath,
              },
            };
            state.status = terminalStatus;
            usage.set(node.id, nodeUsage);
          }
          publish();
          break;
        }
      }
    }
    if (batchStop) {
      for (const state of states.values()) {
        if (state.status === "pending") {
          state.status = "blocked";
          state.blockedReason = `batch ${batchStop}`;
        }
      }
    }
    return snapshot();
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}
