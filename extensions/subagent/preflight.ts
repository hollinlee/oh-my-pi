import type { DagResult, SubagentDag } from "./scheduler.ts";
import { inspectIsolation, type IsolationPlan } from "./worktree.ts";

export type BatchIsolationPreflight = {
  blockers: Array<{ key: string; reason: string; nodeIds: string[] }>;
  reasonsByNode: Map<string, string>;
};

type IsolationInspector = (cwd: string) => Promise<IsolationPlan>;

export async function preflightDagIsolation(
  dag: SubagentDag,
  fallbackCwd: string,
  inspect: IsolationInspector = inspectIsolation,
): Promise<BatchIsolationPreflight> {
  const writeNodes = dag.nodes.filter((node) => node.task.capability.profile !== "read-only");
  const inspected = await Promise.all(writeNodes.map(async (node) => ({
    node,
    plan: await inspect(node.task.scope.cwd || fallbackCwd),
  })));
  const grouped = new Map<string, { key: string; reason: string; nodeIds: string[] }>();
  const reasonsByNode = new Map<string, string>();
  for (const { node, plan } of inspected) {
    if (plan.status !== "blocked") continue;
    reasonsByNode.set(node.id, plan.reason);
    const key = `${plan.code}:${plan.gitRoot || plan.sourcePath}`;
    const existing = grouped.get(key);
    if (existing) existing.nodeIds.push(node.id);
    else grouped.set(key, { key, reason: plan.reason, nodeIds: [node.id] });
  }
  return { blockers: [...grouped.values()], reasonsByNode };
}

export function blockedDagResult(dag: SubagentDag, preflight: BatchIsolationPreflight): DagResult | undefined {
  if (preflight.blockers.length === 0) return undefined;
  return {
    batchId: dag.batchId,
    status: "preflight-blocked",
    budget: dag.budget ?? "standard",
    usage: { turns: 0, toolCalls: 0, elapsedMs: 0 },
    nodes: dag.nodes.map((node) => ({
      id: node.id,
      dependencies: [...node.dependencies],
      status: "blocked",
      blockedReason: preflight.reasonsByNode.get(node.id) ?? "batch isolation preflight failed before dispatch; no child was started",
    })),
    errors: preflight.blockers.map((blocker) => `${blocker.reason} Affected nodes: ${blocker.nodeIds.join(", ")}.`),
  };
}
