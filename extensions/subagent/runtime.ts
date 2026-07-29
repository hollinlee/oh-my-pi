import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { writeUsageIntake } from "../usage/intake.ts";
import { BUDGETS, exceededBudget } from "./budgets.ts";
import { createScopedFileTools, toolNamesForTask } from "./capability.ts";
import { createSandboxedBash } from "./sandbox.ts";
import { ProviderIdleWatchdog } from "./provider-watchdog.ts";
import { prepareIsolation, type PreparedIsolation } from "./worktree.ts";
import {
  SubmittedSubagentResultSchema,
  type BudgetName,
  type SubagentDetails,
  type SubagentResult,
  type SubagentTask,
  type SubagentUsage,
  type SubmittedSubagentResult,
} from "./schemas.ts";

const MAX_EVENTS = 200;

type AbortStatus = "cancelled" | "budget-exhausted" | "runtime-error";

export type RunUpdate = (details: SubagentDetails) => void;

export type ActiveDispatch = {
  abort: (reason?: string) => Promise<void>;
};

function minimalResourceLoader(task: SubagentTask): ResourceLoader {
  const prompt = [
    `You are an isolated subagent running with the ${task.capability.profile} capability profile.`,
    "Complete only the delegated task. Do not infer permissions beyond the active tools and enforced scope.",
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

function assistantText(message: AgentMessage): string | undefined {
  if (message.role !== "assistant") return undefined;
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) return undefined;
  return text.length > 6000 ? `${text.slice(0, 5999)}…` : text;
}

function finalResult(
  task: SubagentTask,
  submitted: SubmittedSubagentResult | undefined,
  usage: SubagentUsage,
  status: SubagentResult["status"],
  summary: string,
  recovery?: SubagentResult["recovery"],
  transcriptPath?: string,
): SubagentResult {
  const metadata = transcriptPath ? { transcriptPath } : {};
  if (submitted) return { ...submitted, taskId: task.id, usage, ...metadata, ...(recovery ? { recovery } : {}) };
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
    ...metadata,
    ...(recovery ? { recovery } : {}),
  };
}

export function ensurePrivateTranscriptPermissions(transcriptPath: string): boolean {
  try {
    fs.chmodSync(transcriptPath, 0o600);
    return true;
  } catch {
    return false;
  }
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
  let childCwd = task.scope.cwd || ctx.cwd;
  const usageProjectPath = childCwd;
  let childTask = task;
  const usage: SubagentUsage = { turns: 0, toolCalls: 0, elapsedMs: 0 };
  const events: SubagentDetails["events"] = [];
  const budget = BUDGETS[budgetName];
  const transcriptDir = path.join(os.homedir(), ".pi", "agent", "subagents", "sessions", ctx.sessionManager.getSessionId());
  fs.mkdirSync(transcriptDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(transcriptDir, 0o700);
  let submitted: SubmittedSubagentResult | undefined;
  let lastAssistantText: string | undefined;
  let abortKind: AbortStatus | undefined;
  let stopReason: string | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let unsubscribe: (() => void) | undefined;
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  let providerWatchdog: ProviderIdleWatchdog | undefined;
  let removeParentAbort: (() => void) | undefined;
  let sandboxCleanup: (() => Promise<void>) | undefined;
  let transcriptPath: string | undefined;
  let isolation: PreparedIsolation | undefined;
  let isolationFinalized = false;

  const snapshot = (status: SubagentDetails["status"], lastActivity?: string, result?: SubagentResult): SubagentDetails => ({
    task,
    status,
    budget: budgetName,
    usage: { ...usage, elapsedMs: Date.now() - startedAt },
    lastActivity,
    events: [...events],
    result,
    stopReason,
    transcriptPath,
  });
  const currentStatus = (): SubagentDetails["status"] => abortKind ?? "running";
  const addEvent = (kind: SubagentDetails["events"][number]["kind"], text: string) => {
    const boundedText = text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
    events.push({ at: Date.now(), kind, text: boundedText });
    if (events.length > MAX_EVENTS) events.shift();
    update(snapshot(currentStatus(), boundedText));
  };
  const abort = async (kind: AbortStatus, reason: string) => {
    if (abortKind) return;
    abortKind = kind;
    stopReason = reason;
    addEvent("status", reason);
    await session?.abort();
  };
  const unregisterActive = registerActive({ abort: (reason = "parent session stopped") => abort("cancelled", reason) });
  const finish = async (status: SubagentDetails["status"], lastActivity: string | undefined, result: SubagentResult): Promise<SubagentDetails> => {
    if (isolation && !isolationFinalized) {
      await isolation.finalize();
      isolationFinalized = true;
      result.handoff = isolation.handoff;
    }
    return snapshot(status, lastActivity, result);
  };

  try {
    update(snapshot("starting", "creating isolated session"));
    const resultTool = defineTool({
      name: "submit_subagent_result",
      label: "Submit Subagent Result",
      description: "Submit the final structured result for the delegated task. Call exactly once when finished.",
      parameters: SubmittedSubagentResultSchema,
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

    if (task.capability.profile !== "read-only") {
      isolation = await prepareIsolation(childCwd, task.id);
      childCwd = isolation.cwd;
      childTask = { ...task, scope: { ...task.scope, cwd: childCwd } };
    }
    const customTools = [...createScopedFileTools(childTask, childCwd), resultTool];
    const sandbox = await createSandboxedBash(childTask, childCwd);
    customTools.push(sandbox.tool);
    sandboxCleanup = sandbox.cleanup;
    const sessionManager = SessionManager.create(childCwd, transcriptDir);
    transcriptPath = sessionManager.getSessionFile();
    const created = await createAgentSession({
      cwd: childCwd,
      model: ctx.model,
      modelRegistry: ctx.modelRegistry,
      tools: toolNamesForTask(childTask),
      customTools,
      resourceLoader: minimalResourceLoader(childTask),
      sessionManager,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1000 },
      }),
    });
    session = created.session;
    providerWatchdog = new ProviderIdleWatchdog(budget.providerIdleMs, () => {
      void abort("runtime-error", `provider inactive for ${Math.floor(budget.providerIdleMs / 1000)} seconds`);
    });

    unsubscribe = session.subscribe((event: any) => {
      usage.elapsedMs = Date.now() - startedAt;
      if (event.type === "turn_start") {
        usage.turns += 1;
        providerWatchdog?.start();
        addEvent("turn", `turn ${usage.turns}/${budget.turns}`);
      } else if (event.type === "message_start" && event.message?.role === "assistant") {
        providerWatchdog?.touch();
      } else if (event.type === "message_update") {
        providerWatchdog?.touch();
      } else if (event.type === "tool_execution_start") {
        providerWatchdog?.stop();
        usage.toolCalls += 1;
        addEvent("tool", `${event.toolName} · running`);
      } else if (event.type === "tool_execution_end") {
        const resultContent = Array.isArray(event.result?.content) ? event.result.content : [];
        const errorText = event.isError
          ? resultContent.filter((part: any) => part.type === "text").map((part: any) => part.text).join(" ").slice(0, 1200)
          : "";
        addEvent("tool", `${event.toolName} · ${event.isError ? `error${errorText ? ` · ${errorText}` : ""}` : "done"}`);
      } else if (event.type === "message_end" && event.message?.role === "assistant") {
        providerWatchdog?.stop();
        lastAssistantText = assistantText(event.message) ?? lastAssistantText;
        if (lastAssistantText) addEvent("text", lastAssistantText);
        const u = event.message.usage;
        if (u) {
          usage.tokens = (usage.tokens ?? 0) + (u.input ?? 0) + (u.output ?? 0);
          usage.cost = (usage.cost ?? 0) + (u.cost?.total ?? 0);
          try {
            writeUsageIntake({
              timestamp: new Date(event.message.timestamp).toISOString(),
              operation: "assistant",
              provider: event.message.provider ?? "",
              model: event.message.model ?? "",
              projectPath: usageProjectPath,
              input: u.input ?? 0,
              output: u.output ?? 0,
              cacheRead: u.cacheRead ?? 0,
              cacheWrite: u.cacheWrite ?? 0,
              cost: u.cost?.total ?? 0,
              responses: 1,
              eventUid: `subagent:${task.id}:${event.message.timestamp}:${usage.turns}`, 
            });
          } catch {
            // Usage accounting must not change the subagent's public runtime contract.
          }
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
    const promptRun = session.prompt(taskPrompt(childTask));
    if (transcriptPath && fs.existsSync(transcriptPath) && !ensurePrivateTranscriptPermissions(transcriptPath)) {
      addEvent("status", "could not apply transcript file mode 0600; parent directory remains mode 0700");
    }
    await promptRun;
    usage.elapsedMs = Date.now() - startedAt;

    const error = assistantError(session.messages);
    const recovery = (reason: string): SubagentResult["recovery"] => ({
      stopReason: reason,
      lastAssistantText,
      recentEvents: events.slice(-24),
    });
    if (abortKind) {
      const reason = stopReason ?? abortKind;
      const result = finalResult(task, submitted, usage, abortKind, reason, recovery(reason), transcriptPath);
      return await finish(abortKind, stopReason, result);
    }
    if (error.stopReason === "error") {
      stopReason = error.errorMessage || "model error";
      const result = finalResult(task, submitted, usage, "model-error", stopReason, recovery(stopReason), transcriptPath);
      return await finish("model-error", stopReason, result);
    }
    if (!submitted) {
      stopReason = "subagent ended without submitting a structured result";
      const result = finalResult(task, undefined, usage, "incomplete", stopReason, recovery(stopReason), transcriptPath);
      return await finish("incomplete", stopReason, result);
    }
    const result = finalResult(task, submitted, usage, submitted.status, submitted.summary, undefined, transcriptPath);
    return await finish(result.status, result.summary, result);
  } catch (error) {
    usage.elapsedMs = Date.now() - startedAt;
    const rawMessage = error instanceof Error ? error.message : String(error);
    const permissionDenied = error instanceof Error && (
      error.name === "CapabilityViolation" ||
      /SUBAGENT_PERMISSION_DENIED|Operation not permitted|outside allowed scope|denied by excluded scope/.test(rawMessage)
    );
    const message = permissionDenied
      ? `Capability denied: ${rawMessage.replace(/^SUBAGENT_PERMISSION_DENIED:\s*/, "")}`
      : rawMessage;
    const status = abortKind ?? (permissionDenied ? "tool-error" : "runtime-error");
    stopReason = stopReason ?? message;
    const result = finalResult(task, submitted, usage, status, stopReason, {
      stopReason,
      lastAssistantText,
      recentEvents: events.slice(-24),
    }, transcriptPath);
    return await finish(status, stopReason, result);
  } finally {
    if (wallTimer) clearTimeout(wallTimer);
    providerWatchdog?.stop();
    removeParentAbort?.();
    unsubscribe?.();
    if (session?.isStreaming) await session.abort().catch(() => {});
    session?.dispose();
    await sandboxCleanup?.().catch(() => {});
    if (isolation && !isolationFinalized) await isolation.finalize();
    if (transcriptPath && fs.existsSync(transcriptPath)) ensurePrivateTranscriptPermissions(transcriptPath);
    unregisterActive();
  }
}
