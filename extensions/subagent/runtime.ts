import {
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  type ExtensionContext,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { BUDGETS, exceededBudget } from "./budgets.ts";
import {
  SubagentResultSchema,
  type BudgetName,
  type SubagentDetails,
  type SubagentResult,
  type SubagentTask,
  type SubagentUsage,
  type SubmittedSubagentResult,
} from "./schemas.ts";

const MAX_EVENTS = 200;

export type RunUpdate = (details: SubagentDetails) => void;

export type ActiveDispatch = {
  abort: (reason?: string) => Promise<void>;
};

function minimalResourceLoader(task: SubagentTask): ResourceLoader {
  const prompt = [
    "You are an isolated read-only subagent.",
    "Complete only the delegated task. Do not infer permissions beyond the active tools.",
    "When finished, call submit_subagent_result exactly once with a structured result.",
    "If essential context is missing, return status needs-context with the minimum questions.",
    "Do not claim verification you did not perform.",
    "",
    `Task ID: ${task.id}`,
  ].join("\n");
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => prompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function taskPrompt(task: SubagentTask): string {
  return JSON.stringify({
    objective: task.objective,
    acceptanceCriteria: task.acceptanceCriteria,
    context: task.context,
    scope: task.scope,
    constraints: task.constraints,
    nonGoals: task.nonGoals,
    expectedOutput: task.expectedOutput,
  }, null, 2);
}

function assistantError(messages: readonly AgentMessage[]): { stopReason?: string; errorMessage?: string } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    return { stopReason: message.stopReason, errorMessage: message.errorMessage };
  }
  return {};
}

function finalResult(task: SubagentTask, submitted: SubmittedSubagentResult | undefined, usage: SubagentUsage, status: SubagentResult["status"], summary: string): SubagentResult {
  if (submitted) return { ...submitted, taskId: task.id, usage };
  return {
    taskId: task.id,
    status,
    summary,
    evidence: [],
    changes: [],
    verification: [],
    risks: [],
    remainingWork: status === "completed" ? [] : [summary],
    questions: [],
    usage,
  };
}

export async function runSubagent(
  task: SubagentTask,
  budgetName: BudgetName,
  ctx: ExtensionContext,
  parentSignal: AbortSignal | undefined,
  update: RunUpdate,
  registerActive: (dispatch: ActiveDispatch) => () => void,
): Promise<SubagentDetails> {
  const startedAt = Date.now();
  const usage: SubagentUsage = { turns: 0, toolCalls: 0, elapsedMs: 0 };
  const events: SubagentDetails["events"] = [];
  const budget = BUDGETS[budgetName];
  let submitted: SubmittedSubagentResult | undefined;
  let abortKind: "cancelled" | "budget-exhausted" | undefined;
  let stopReason: string | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let unsubscribe: (() => void) | undefined;
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbort: (() => void) | undefined;

  const snapshot = (status: SubagentDetails["status"], lastActivity?: string, result?: SubagentResult): SubagentDetails => ({
    task,
    status,
    budget: budgetName,
    usage: { ...usage, elapsedMs: Date.now() - startedAt },
    lastActivity,
    events: [...events],
    result,
    stopReason,
  });
  const addEvent = (kind: SubagentDetails["events"][number]["kind"], text: string) => {
    events.push({ at: Date.now(), kind, text });
    if (events.length > MAX_EVENTS) events.shift();
    update(snapshot("running", text));
  };
  const abort = async (kind: "cancelled" | "budget-exhausted", reason: string) => {
    if (!abortKind) abortKind = kind;
    stopReason = reason;
    await session?.abort();
  };
  const unregisterActive = registerActive({ abort: (reason = "parent session stopped") => abort("cancelled", reason) });

  try {
    update(snapshot("starting", "creating isolated session"));
    const resultTool = defineTool({
      name: "submit_subagent_result",
      label: "Submit Subagent Result",
      description: "Submit the final structured result for the delegated task. Call exactly once when finished.",
      parameters: SubagentResultSchema,
      async execute(_id, params) {
        if (params.taskId !== task.id) throw new Error(`taskId mismatch: expected ${task.id}`);
        submitted = params;
        return {
          content: [{ type: "text", text: "Structured subagent result accepted." }],
          details: { taskId: task.id, status: params.status },
          terminate: true,
        };
      },
    });

    const created = await createAgentSession({
      cwd: task.scope.cwd || ctx.cwd,
      model: ctx.model,
      modelRegistry: ctx.modelRegistry,
      tools: ["read", "grep", "find", "ls", "submit_subagent_result"],
      customTools: [resultTool],
      resourceLoader: minimalResourceLoader(task),
      sessionManager: SessionManager.inMemory(task.scope.cwd || ctx.cwd),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    });
    session = created.session;

    unsubscribe = session.subscribe((event: any) => {
      usage.elapsedMs = Date.now() - startedAt;
      if (event.type === "turn_start") {
        usage.turns += 1;
        addEvent("turn", `turn ${usage.turns}/${budget.turns}`);
      } else if (event.type === "tool_execution_start") {
        usage.toolCalls += 1;
        addEvent("tool", `${event.toolName} · running`);
      } else if (event.type === "tool_execution_end") {
        addEvent("tool", `${event.toolName} · ${event.isError ? "error" : "done"}`);
      } else if (event.type === "message_end" && event.message?.role === "assistant") {
        const u = event.message.usage;
        if (u) {
          usage.tokens = (usage.tokens ?? 0) + (u.input ?? 0) + (u.output ?? 0);
          usage.cost = (usage.cost ?? 0) + (u.cost?.total ?? 0);
        }
      }
      const exceeded = exceededBudget(usage, budget);
      if (exceeded && !abortKind) void abort("budget-exhausted", `${exceeded} budget exhausted`);
    });

    wallTimer = setTimeout(() => void abort("budget-exhausted", "wall-time budget exhausted"), budget.wallTimeMs);
    const onParentAbort = () => void abort("cancelled", "cancelled by parent");
    if (parentSignal) {
      if (parentSignal.aborted) onParentAbort();
      else {
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
        removeParentAbort = () => parentSignal.removeEventListener("abort", onParentAbort);
      }
    }

    update(snapshot("running", "agent started"));
    await session.prompt(taskPrompt(task));
    usage.elapsedMs = Date.now() - startedAt;

    const error = assistantError(session.messages);
    if (abortKind) {
      const result = finalResult(task, submitted, usage, abortKind, stopReason ?? abortKind);
      return snapshot(abortKind, stopReason, result);
    }
    if (error.stopReason === "error") {
      stopReason = error.errorMessage || "model error";
      const result = finalResult(task, submitted, usage, "model-error", stopReason);
      return snapshot("model-error", stopReason, result);
    }
    if (!submitted) {
      stopReason = "subagent ended without submitting a structured result";
      const result = finalResult(task, undefined, usage, "incomplete", stopReason);
      return snapshot("incomplete", stopReason, result);
    }
    const result = finalResult(task, submitted, usage, submitted.status, submitted.summary);
    return snapshot(result.status, result.summary, result);
  } catch (error) {
    usage.elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const status = abortKind ?? "runtime-error";
    stopReason = stopReason ?? message;
    const result = finalResult(task, submitted, usage, status, stopReason);
    return snapshot(status, stopReason, result);
  } finally {
    if (wallTimer) clearTimeout(wallTimer);
    removeParentAbort?.();
    unsubscribe?.();
    if (session?.isStreaming) await session.abort().catch(() => {});
    session?.dispose();
    unregisterActive();
  }
}
