import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { formatElapsed, BUDGETS } from "./budgets.ts";
import { runSubagent, type ActiveDispatch } from "./runtime.ts";
import { SubagentTaskSchema, type BudgetName, type SubagentDetails } from "./schemas.ts";

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

export default function subagentExtension(pi: ExtensionAPI) {
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

      const registerActive = (dispatch: ActiveDispatch) => {
        active.add(dispatch);
        return () => active.delete(dispatch);
      };
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
        `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.id)}${theme.fg("muted", ` · read-only · ${budget}`)}\n  ${theme.fg("dim", objective)}`,
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

  pi.on("session_shutdown", async () => {
    const pending = [...active];
    await Promise.allSettled(pending.map((dispatch) => dispatch.abort("parent session shutdown")));
    active.clear();
  });
}
