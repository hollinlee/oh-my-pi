import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ModelConfigSchema, TaskSpecSchema } from "./schemas.ts";
import { TaskCheckpointStore } from "./store.ts";
import { createSubagentExecutionAdapter, ModelTaskHarness } from "./harness.ts";
import type { ActiveDispatch } from "../subagent/runtime.ts";

const active = new Set<ActiveDispatch>();

export function isModelTaskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OH_MY_PI_MODEL_TASK_ENABLED === "1";
}

export default function modelTaskExtension(pi: ExtensionAPI) {
  if (!isModelTaskEnabled()) return;

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
      const store = new TaskCheckpointStore(path.join(os.homedir(), ".pi", "agent", "model-tasks"));
      const harness = new ModelTaskHarness(
        store,
        (model) => ctx.modelRegistry.find(model.provider, model.model),
        createSubagentExecutionAdapter(ctx, registerActive),
      );
      const checkpoint = await harness.run(params.task, {
        global: params.globalModelConfig,
        project: params.projectModelConfig,
      }, signal);
      onUpdate?.({
        content: [{ type: "text", text: `${checkpoint.task.id}: ${checkpoint.status} · ${checkpoint.activeModel?.model ?? "no model"}` }],
        details: checkpoint,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(checkpoint, null, 2) }],
        details: checkpoint,
      };
    },
  });

  pi.on("session_shutdown", async () => {
    await Promise.allSettled([...active].map((dispatch) => dispatch.abort("parent session stopped")));
    active.clear();
  });
}
