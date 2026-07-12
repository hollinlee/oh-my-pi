import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { formatElapsed, BUDGETS } from "./budgets.ts";
import { runSubagent, type ActiveDispatch } from "./runtime.ts";
import { BATCH_BUDGETS, runDag, SubagentDagSchema, validateDag, type DagResult } from "./scheduler.ts";
import { SubagentTaskSchema, type BudgetName, type SubagentDetails, type SubagentTask } from "./schemas.ts";

const active = new Set<ActiveDispatch>();

function usageLine(details: SubagentDetails): string {
  const limit = BUDGETS[details.budget];
  const parts = [
    `${details.usage.turns}/${limit.turns} turns`,
    `${details.usage.toolCalls}/${limit.toolCalls} tools`,
    `${formatElapsed(details.usage.elapsedMs)}/${formatElapsed(limit.wallTimeMs)}`,
  ];
  if (details.usage.tokens !== undefined) parts.push(`${Math.round(details.usage.tokens / 1000)}k tokens`);
  if (details.usage.cost !== undefined && details.usage.cost > 0) parts.push(`$${details.usage.cost.toFixed(4)}`);
  return parts.join(" · ");
}

function statusTone(status: SubagentDetails["status"]): "success" | "warning" | "error" | "accent" {
  if (status === "completed") return "success";
  if (status === "starting" || status === "running") return "accent";
  if (status === "needs-context" || status === "incomplete" || status === "budget-exhausted" || status === "cancelled") return "warning";
  return "error";
}

function capText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function dagModelContent(result: DagResult): string {
  const aggregate = {
    batchId: result.batchId,
    status: result.status,
    budget: result.budget,
    usage: result.usage,
    errors: result.errors,
    nodes: result.nodes.map((node) => ({
      id: node.id,
      dependencies: node.dependencies,
      status: node.status,
      blockedReason: node.blockedReason,
      result: node.details?.result,
    })),
  };
  const full = JSON.stringify(aggregate, null, 2);
  if (Buffer.byteLength(full, "utf8") <= 50 * 1024) return full;
  const bounded = JSON.stringify({
    ...aggregate,
    nodes: aggregate.nodes.map((node) => ({
      ...node,
      result: node.result ? {
        taskId: node.result.taskId,
        status: node.result.status,
        summary: capText(node.result.summary, 2000),
        evidence: (node.result.evidence ?? []).slice(0, 10).map((item) => ({ claim: capText(item.claim, 500), source: capText(item.source, 1000) })),
        changes: (node.result.changes ?? []).slice(0, 20).map((item) => ({ path: capText(item.path, 1000), summary: capText(item.summary, 500) })),
        verification: (node.result.verification ?? []).slice(0, 10).map((item) => ({ command: capText(item.command, 1000), outcome: capText(item.outcome, 500) })),
        risks: (node.result.risks ?? []).slice(0, 10).map((item) => capText(item, 500)),
        remainingWork: (node.result.remainingWork ?? []).slice(0, 10).map((item) => capText(item, 500)),
        usage: node.result.usage,
        handoff: node.result.handoff ? {
          mode: node.result.handoff.mode,
          state: node.result.handoff.state,
          sourcePath: capText(node.result.handoff.sourcePath, 1000),
          workspacePath: capText(node.result.handoff.workspacePath, 1000),
          branch: capText(node.result.handoff.branch, 500),
          changedPaths: node.result.handoff.changedPaths.slice(0, 20).map((item) => capText(item, 1000)),
          untrackedPaths: node.result.handoff.untrackedPaths.slice(0, 20).map((item) => capText(item, 1000)),
          binaryPaths: node.result.handoff.binaryPaths.slice(0, 20).map((item) => capText(item, 1000)),
          patchArtifact: capText(node.result.handoff.patchArtifact, 1000),
          retained: node.result.handoff.retained,
          error: capText(node.result.handoff.error, 1000),
        } : undefined,
      } : undefined,
    })),
    truncated: true,
  }, null, 2);
  if (Buffer.byteLength(bounded, "utf8") <= 50 * 1024) return bounded;
  return JSON.stringify({
    batchId: result.batchId,
    status: result.status,
    budget: result.budget,
    usage: result.usage,
    errors: result.errors.map((error) => capText(error, 500)),
    nodes: result.nodes.map((node) => ({
      id: node.id,
      dependencies: node.dependencies,
      status: node.status,
      blockedReason: capText(node.blockedReason, 500),
      summary: capText(node.details?.result?.summary, 500),
      workspacePath: capText(node.details?.result?.handoff?.workspacePath, 1000),
      patchArtifact: capText(node.details?.result?.handoff?.patchArtifact, 1000),
    })),
    truncated: true,
    aggressivelyTruncated: true,
  }, null, 2);
}

export default function subagentExtension(pi: ExtensionAPI) {
  const registerActive = (dispatch: ActiveDispatch) => {
    active.add(dispatch);
    return () => active.delete(dispatch);
  };

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Delegate a bounded, isolated task with a runtime-enforced capability profile. read-only is automatic; workspace-write and elevated require approval and use an OS sandbox for bash.",
    promptSnippet: "Run an isolated subagent with an explicit capability profile, scope, acceptance criteria, and budget",
    promptGuidelines: [
      "Use subagent only when an isolated delegated task has a clear objective and acceptance criteria.",
      "Prefer the read-only subagent profile. Use workspace-write only when file changes are necessary, and elevated only for explicit one-dispatch overrides.",
      "Do not include private conversation history in subagent context; pass only facts needed for the task.",
    ],
    parameters: SubagentTaskSchema,

    async execute(_toolCallId, task, signal, onUpdate, ctx) {
      const budget: BudgetName = task.budget ?? "standard";
      const profile = task.capability.profile;
      const overrides = task.capability.overrides ?? [];
      if (profile === "elevated" && overrides.length === 0) {
        return { content: [{ type: "text", text: "Subagent dispatch blocked: elevated requires explicit overrides." }], details: undefined };
      }
      if (profile !== "read-only") {
        if (process.platform !== "darwin" && process.platform !== "linux") {
          return { content: [{ type: "text", text: `Subagent dispatch blocked: ${profile} sandbox is unsupported on ${process.platform}.` }], details: undefined };
        }
        if (!ctx.hasUI) {
          return { content: [{ type: "text", text: `Subagent dispatch blocked: ${profile} requires interactive approval.` }], details: undefined };
        }
        const approved = await ctx.ui.confirm(
          "Subagent capability approval",
          `Task: ${task.id}\nProfile: ${profile}\nScope: ${task.scope.cwd || ctx.cwd}\nOverrides: ${overrides.join(", ") || "none"}\n\n${task.objective}`,
        );
        if (!approved) {
          return { content: [{ type: "text", text: "Subagent dispatch cancelled: capability was not approved." }], details: undefined };
        }
      }
      if (budget === "large" && ctx.hasUI) {
        const large = BUDGETS.large;
        const approved = await ctx.ui.confirm(
          "Large subagent budget",
          `Task: ${task.id}\nLimit: ${large.turns} turns · ${large.toolCalls} tools · ${formatElapsed(large.wallTimeMs)}\n\n${task.objective}`,
        );
        if (!approved) {
          return {
            content: [{ type: "text", text: "Subagent dispatch cancelled: large budget was not approved." }],
            details: undefined,
          };
        }
      } else if (budget === "large" && !ctx.hasUI) {
        return {
          content: [{ type: "text", text: "Subagent dispatch blocked: large budget requires interactive approval." }],
          details: undefined,
        };
      }

      const publish = (details: SubagentDetails) => {
        onUpdate?.({ content: [{ type: "text", text: `${details.task.id}: ${details.status}` }], details });
        pi.events.emit("oh-my-pi:step", { text: `subagent ${details.task.id} · ${details.status}` });
        pi.events.emit("oh-my-pi:detail", {
          source: "subagent",
          summary: `${details.task.id} · ${details.status}`,
          info: usageLine(details),
          tone: statusTone(details.status) === "error" ? "error" : statusTone(details.status) === "warning" ? "warn" : "normal",
        });
      };

      const details = await runSubagent(task, budget, ctx, signal, publish, registerActive);
      const result = details.result;
      return {
        content: [{ type: "text", text: JSON.stringify(result ?? { taskId: task.id, status: details.status, summary: details.stopReason ?? "No result" }, null, 2) }],
        details,
      };
    },

    renderCall(args, theme) {
      const budget = args.budget ?? "standard";
      const objective = args.objective.length > 100 ? `${args.objective.slice(0, 99)}…` : args.objective;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.id)}${theme.fg("muted", ` · ${args.capability.profile} · ${budget}`)}\n  ${theme.fg("dim", objective)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as SubagentDetails | undefined;
      if (!details) {
        const text = result.content.find((part) => part.type === "text");
        return new Text(text?.type === "text" ? text.text : "No subagent result", 0, 0);
      }
      const tone = statusTone(details.status);
      const icon = details.status === "completed" ? "✓" : details.status === "running" || details.status === "starting" ? "⏳" : "✗";
      const header = `${theme.fg(tone, icon)} ${theme.fg("toolTitle", theme.bold(details.task.id))}${theme.fg("muted", ` · ${details.status} · ${details.task.capability.profile}`)}`;
      const usage = theme.fg("dim", usageLine(details));
      const last = details.lastActivity ? `\n${theme.fg("muted", "LAST ")}${theme.fg("toolOutput", details.lastActivity)}` : "";
      if (!expanded) return new Text(`${header}\n${usage}${last}`, 0, 0);

      const container = new Container();
      container.addChild(new Text(`${header}\n${usage}`, 0, 0));
      container.addChild(new Text(`\n${theme.fg("muted", "OBJECTIVE")}\n${details.task.objective}`, 0, 0));
      if (details.events.length > 0) {
        const eventText = details.events.map((event) => `${new Date(event.at).toISOString()}  ${event.kind}  ${event.text}`).join("\n");
        container.addChild(new Text(`\n${theme.fg("muted", "EVENTS")}\n${theme.fg("dim", eventText)}`, 0, 0));
      }
      if (details.result) container.addChild(new Text(`\n${theme.fg("muted", "RESULT")}\n${JSON.stringify(details.result, null, 2)}`, 0, 0));
      if (details.stopReason) container.addChild(new Text(`\n${theme.fg(tone, `STOP ${details.stopReason}`)}`, 0, 0));
      return container;
    },
  });

  pi.registerTool({
    name: "subagent_batch",
    label: "Subagent Batch",
    description: "Run a bounded deterministic DAG of isolated subagent tasks. Maximum 8 nodes, concurrency 3, depth 3. The scheduler never adds nodes or starts another batch.",
    promptSnippet: "Run an explicit bounded DAG of subagent tasks with dependencies and a batch budget",
    promptGuidelines: [
      "Use subagent_batch only when the complete DAG, dependencies, scopes, capabilities, and acceptance criteria are explicit.",
      "Do not use subagent_batch as a hidden planner or recursive swarm; the parent agent must decide every node before dispatch.",
    ],
    parameters: SubagentDagSchema,

    async execute(_toolCallId, dag, signal, onUpdate, ctx) {
      const validationErrors = validateDag(dag);
      if (validationErrors.length > 0) {
        const details: DagResult = {
          batchId: dag.batchId,
          status: "invalid",
          budget: dag.budget ?? "standard",
          usage: { turns: 0, toolCalls: 0, elapsedMs: 0 },
          nodes: dag.nodes.map((node) => ({ id: node.id, dependencies: [...node.dependencies], status: "pending" })),
          errors: validationErrors,
        };
        return { content: [{ type: "text", text: dagModelContent(details) }], details };
      }
      const writeNodes = dag.nodes.filter((node) => node.task.capability.profile !== "read-only");
      const largeNodes = dag.nodes.filter((node) => (node.task.budget ?? "standard") === "large");
      const batchBudget = dag.budget ?? "standard";
      if (writeNodes.length > 0 || largeNodes.length > 0 || batchBudget === "large") {
        if (!ctx.hasUI) {
          return { content: [{ type: "text", text: "Subagent batch blocked: write/elevated/large execution requires interactive approval." }], details: undefined };
        }
        const limit = BATCH_BUDGETS[batchBudget];
        const approved = await ctx.ui.confirm(
          "Subagent batch approval",
          [
            `Batch: ${dag.batchId}`,
            `Nodes: ${dag.nodes.length} · concurrency ${dag.concurrency ?? 3}`,
            `Budget: ${limit.turns} turns · ${limit.toolCalls} tools · ${formatElapsed(limit.wallTimeMs)}`,
            `Write/elevated: ${writeNodes.map((node) => `${node.id}:${node.task.capability.profile}`).join(", ") || "none"}`,
            `Large nodes: ${largeNodes.map((node) => node.id).join(", ") || "none"}`,
          ].join("\n"),
        );
        if (!approved) return { content: [{ type: "text", text: "Subagent batch cancelled: execution was not approved." }], details: undefined };
      }

      const controller = new AbortController();
      const onParentAbort = () => controller.abort();
      if (signal?.aborted) onParentAbort();
      else signal?.addEventListener("abort", onParentAbort, { once: true });
      const unregisterBatch = registerActive({ abort: async () => controller.abort() });
      try {
        const result = await runDag(
          dag,
          controller.signal,
          (task: SubagentTask, childSignal, publish) => runSubagent(task, task.budget ?? "standard", ctx, childSignal, publish, registerActive),
          (partial) => {
            onUpdate?.({ content: [{ type: "text", text: `${partial.batchId}: ${partial.status}` }], details: partial });
            const completed = partial.nodes.filter((node) => node.status === "completed").length;
            const running = partial.nodes.filter((node) => node.status === "running" || node.status === "starting").length;
            const blocked = partial.nodes.filter((node) => node.status === "blocked").length;
            pi.events.emit("oh-my-pi:step", { text: `batch ${partial.batchId} · ${partial.status}` });
            pi.events.emit("oh-my-pi:detail", {
              source: "subagent-batch",
              summary: `${partial.batchId} · ${completed}/${partial.nodes.length} completed`,
              info: `${running} running · ${blocked} blocked · ${partial.usage.turns} turns`,
              tone: partial.status === "completed" ? "normal" : partial.status === "partial" ? "warn" : "error",
            });
          },
        );
        return { content: [{ type: "text", text: dagModelContent(result) }], details: result };
      } finally {
        signal?.removeEventListener("abort", onParentAbort);
        unregisterBatch();
      }
    },

    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent_batch "))}${theme.fg("accent", args.batchId)}${theme.fg("muted", ` · ${args.nodes.length} nodes · concurrency ${args.concurrency ?? 3} · ${args.budget ?? "standard"}`)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as DagResult | undefined;
      if (!details) {
        const text = result.content.find((part) => part.type === "text");
        return new Text(text?.type === "text" ? text.text : "No batch result", 0, 0);
      }
      const completed = details.nodes.filter((node) => node.status === "completed").length;
      const running = details.nodes.filter((node) => node.status === "running" || node.status === "starting").length;
      const blocked = details.nodes.filter((node) => node.status === "blocked").length;
      const tone = details.status === "completed" ? "success" : details.status === "partial" ? "warning" : "error";
      let text = `${theme.fg(tone, details.status === "completed" ? "✓" : "✗")} ${theme.fg("toolTitle", theme.bold(details.batchId))}${theme.fg("muted", ` · ${details.status}`)}`;
      text += `\n${theme.fg("dim", `${completed}/${details.nodes.length} completed · ${running} running · ${blocked} blocked · ${details.usage.turns} turns · ${details.usage.toolCalls} tools`)}`;
      if (expanded) {
        for (const node of details.nodes) {
          text += `\n\n${theme.fg("accent", node.id)} ${theme.fg("muted", `← ${node.dependencies.join(", ") || "root"}`)} ${theme.fg(node.status === "completed" ? "success" : node.status === "blocked" ? "warning" : "error", node.status)}`;
          if (node.blockedReason) text += `\n  ${theme.fg("warning", node.blockedReason)}`;
          if (node.details?.result?.summary) text += `\n  ${node.details.result.summary}`;
        }
        if (details.errors.length > 0) text += `\n\n${theme.fg("error", details.errors.join("\n"))}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.on("session_shutdown", async () => {
    const pending = [...active];
    await Promise.allSettled(pending.map((dispatch) => dispatch.abort("parent session shutdown")));
    active.clear();
  });
}
