import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { ModelConfigSchema, TaskSpecSchema, type TaskCheckpoint } from "./schemas.ts";
import { RemoteExperimentSchema } from "./remote-schemas.ts";
import { RemoteExperimentRunner, RemoteExperimentStore } from "./remote-runner.ts";
import { createConfiguredRemoteExperimentExecutor } from "./remote-adapter.ts";
import { TaskCheckpointStore } from "./store.ts";
import { createSubagentExecutionAdapter, ModelTaskHarness } from "./harness.ts";
import type { ActiveDispatch } from "../subagent/runtime.ts";
import { formatFinalReport, formatTaskStatus, redactTaskDisplay, snapshotFromCheckpoint, TaskProgressTracker, type TaskProgressSnapshot } from "./observability.ts";

const active = new Set<ActiveDispatch>();
const latestSnapshots = new Map<string, TaskProgressSnapshot>();
const progressTrackers = new Map<string, TaskProgressTracker>();
const STATUS_KEY = "model-task-progress";
const WIDGET_KEY = "model-task-panel";
const MAX_RETAINED_TASKS = 20;
const CHECKPOINT_ROOT = path.join(os.homedir(), ".pi", "agent", "model-tasks");

function rememberSnapshot(snapshot: TaskProgressSnapshot): void {
  latestSnapshots.delete(snapshot.taskId);
  latestSnapshots.set(snapshot.taskId, snapshot);
  while (latestSnapshots.size > MAX_RETAINED_TASKS) {
    const oldest = latestSnapshots.keys().next().value;
    if (oldest === undefined) break;
    latestSnapshots.delete(oldest);
    progressTrackers.delete(oldest);
  }
}

export function isModelTaskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OH_MY_PI_MODEL_TASK_ENABLED === "1";
}

export function renderTaskPanel(snapshot: TaskProgressSnapshot, expanded = false): string[] {
  const model = snapshot.model
    ? `${snapshot.model.provider}/${snapshot.model.name} · ${snapshot.model.role} · ${snapshot.model.source}`
    : "model pending";
  const lines = [
    `TASK ${snapshot.taskId} · ${snapshot.phase}/${snapshot.status} · ${Math.floor(snapshot.elapsedMs / 1000)}s${snapshot.risk ? " · RISK" : ""}`,
    `MODEL ${model}`,
    `NOW ${snapshot.recentEvents.at(-1)?.summary ?? snapshot.goal}`,
  ];
  if (!expanded) return lines;
  if (snapshot.recentEvents.length > 0) lines.push("EVENTS", ...snapshot.recentEvents.map((item) => `${item.at}  ${item.kind}  ${item.summary}`));
  if (snapshot.commandSummaries.length > 0) lines.push("COMMANDS", ...snapshot.commandSummaries);
  if (snapshot.verification.length > 0) lines.push("VERIFICATION", ...snapshot.verification.map((item) => `${item.command} · ${item.outcome}${item.logPath ? ` · ${item.logPath}` : ""}`));
  if (snapshot.final) {
    lines.push("FINAL", snapshot.final.summary);
    if (snapshot.final.changes.length > 0) lines.push("CHANGES", ...snapshot.final.changes);
    if (snapshot.final.risks.length > 0) lines.push("RISKS", ...snapshot.final.risks);
    if (snapshot.final.nextActions.length > 0) lines.push("NEXT", ...snapshot.final.nextActions);
  }
  if (snapshot.status === "needs_review" || snapshot.status === "blocked") {
    lines.push("ACTIONS", "Review checkpoint evidence before explicitly revising or retrying the task; keep blocked to grant no new permission.");
  }
  return lines;
}

export default function modelTaskExtension(pi: ExtensionAPI) {
  if (!isModelTaskEnabled()) return;

  const publish = (checkpoint: TaskCheckpoint, ctx: ExtensionContext) => {
    const tracker = progressTrackers.get(checkpoint.task.id) ?? new TaskProgressTracker();
    progressTrackers.set(checkpoint.task.id, tracker);
    const effects = tracker.update(checkpoint);
    rememberSnapshot(effects.snapshot);
    pi.events.emit("model-task:progress", effects.snapshot);
    pi.events.emit("oh-my-pi:step", { text: formatTaskStatus(effects.snapshot) });
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, formatTaskStatus(effects.snapshot));
      ctx.ui.setWidget(WIDGET_KEY, renderTaskPanel(effects.snapshot), { placement: "belowEditor" });
      for (const notice of effects.immediate) ctx.ui.notify(notice.text, notice.level);
      if (effects.heartbeat) ctx.ui.notify(effects.heartbeat, "info");
    }
  };

  pi.registerCommand("model-task", {
    description: "Show the latest model task progress panel",
    handler: async (args, ctx) => {
      const id = String(args ?? "").trim();
      let snapshot = id ? latestSnapshots.get(id) : [...latestSnapshots.values()].at(-1);
      if (!snapshot && id) {
        const checkpoint = await new TaskCheckpointStore(CHECKPOINT_ROOT).load(id);
        if (checkpoint) {
          snapshot = snapshotFromCheckpoint(checkpoint);
          rememberSnapshot(snapshot);
        }
      }
      if (!snapshot) {
        if (ctx.hasUI) ctx.ui.notify("No model task progress available.", "info");
        return;
      }
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify(JSON.stringify(snapshot, null, 2), "info");
        return;
      }
      await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => ({
        render: (width) => renderTaskPanel(snapshot, true).map((line) => theme.fg("text", line.slice(0, width))),
        handleInput: () => done(),
        invalidate() {},
      }));
    },
  });

  pi.registerTool({
    name: "model_task_run",
    label: "Model task",
    description: "Run or resume a versioned coding task with a configured execution model in an isolated workspace.",
    promptSnippet: "Run a structured coding task through the configured local execution model",
    promptGuidelines: [
      "Use only for a task with explicit scope, acceptance criteria, constraints, and execution model configuration.",
      "The execution model may edit only its isolated workspace and cannot commit, push, deploy, install packages, or use the network.",
      "A blocked or needs_review result must be reported to the user; do not silently expand scope or permissions.",
    ],
    parameters: Type.Object({
      task: TaskSpecSchema,
      globalModelConfig: Type.Optional(ModelConfigSchema),
      projectModelConfig: Type.Optional(ModelConfigSchema),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const registerActive = (dispatch: ActiveDispatch) => {
        active.add(dispatch);
        return () => active.delete(dispatch);
      };
      const store = new TaskCheckpointStore(CHECKPOINT_ROOT);
      let latestCheckpoint: TaskCheckpoint | undefined;
      const harness = new ModelTaskHarness(
        store,
        (model) => ctx.modelRegistry.find(model.provider, model.model),
        createSubagentExecutionAdapter(ctx, registerActive),
        (checkpoint) => {
          latestCheckpoint = checkpoint;
          publish(checkpoint, ctx);
        },
      );
      const heartbeat = setInterval(() => {
        if (latestCheckpoint) publish(latestCheckpoint, ctx);
      }, 60_000);
      heartbeat.unref?.();
      let checkpoint;
      try {
        checkpoint = await harness.run(params.task, {
          global: params.globalModelConfig,
          project: params.projectModelConfig,
        }, signal);
      } finally {
        clearInterval(heartbeat);
      }
      onUpdate?.({
        content: [{ type: "text", text: `${checkpoint.task.id}: ${checkpoint.status} · ${checkpoint.activeModel?.model ?? "no model"}` }],
        details: checkpoint,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(formatFinalReport(checkpoint), null, 2) }],
        details: checkpoint,
      };
    },
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("model task "))}${theme.fg("accent", args.task.id)}\n${theme.fg("dim", redactTaskDisplay(args.task.goal))}`, 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const checkpoint = result.details as TaskCheckpoint | undefined;
      if (!checkpoint) return new Text(result.content.find((item) => item.type === "text")?.text ?? "No task result", 0, 0);
      const lines = renderTaskPanel(snapshotFromCheckpoint(checkpoint), expanded);
      const tone = checkpoint.status === "succeeded" ? "success" : checkpoint.status === "running" ? "accent" : "warning";
      return new Text(lines.map((line, index) => theme.fg(index === 0 ? tone : "toolOutput", line)).join("\n"), 0, 0);
    },
  });

  pi.registerTool({
    name: "model_task_remote_experiment",
    label: "Remote experiment",
    description: "Run a declared, checkpointed remote experiment on one explicitly selected configured device.",
    promptSnippet: "Run a bounded remote experiment with explicit device, workdir, command allowlist, and resource limits",
    promptGuidelines: [
      "The experiment must name an exact configured device ID; never select or switch devices automatically.",
      "Declare an absolute or home-relative remote workdir, command allowlist, resource limit, timeouts, retry policy, and cleanup requirements.",
      "Non-idempotent commands are never automatically retried; high-risk commands require interactive approval.",
    ],
    parameters: RemoteExperimentSchema,
    async execute(_id, experiment, signal, onUpdate, ctx) {
      const store = new RemoteExperimentStore(path.join(os.homedir(), ".pi", "agent", "model-tasks", "remote-experiments"));
      const runner = new RemoteExperimentRunner(
        createConfiguredRemoteExperimentExecutor(),
        async (request) => {
          if (!ctx.hasUI) return false;
          return ctx.ui.confirm(
            "Remote high-risk command approval",
            `Device: ${request.deviceId}\nUser: ${request.user}\nWorkdir: ${request.workdir}\n\n${request.command}`,
          );
        },
        store,
      );
      onUpdate?.({ content: [{ type: "text", text: `${experiment.id}: running on ${experiment.deviceId}` }] });
      const result = await runner.run(experiment, signal);
      onUpdate?.({ content: [{ type: "text", text: `${experiment.id}: ${result.status}` }], details: result });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result, isError: result.status === "failed" || result.status === "blocked" || result.status === "needs_review" };
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "belowEditor" });
    }
    latestSnapshots.clear();
    progressTrackers.clear();
    await Promise.allSettled([...active].map((dispatch) => dispatch.abort("parent session stopped")));
    active.clear();
  });
}
