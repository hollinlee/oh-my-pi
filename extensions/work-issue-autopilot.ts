import type { AssistantMessage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const STATE_TYPE = "oh-my-pi-work-issue-autopilot";
const MAX_STALLED_CONTINUATIONS = 8;

type WorkflowPhase = "active" | "blocked" | "completed" | "stopped";

export type WorkIssueState = {
  queue: string[];
  remaining: string[];
  phase: WorkflowPhase;
  stalledContinuations: number;
  lastSummary?: string;
  blocker?: string;
  updatedAt: number;
};

type Checkpoint = {
  status: "progress" | "issue-completed" | "human-gate" | "queue-completed";
  issue?: string;
  summary: string;
  blocker?: string;
};

function normalizeIssue(value: string): string {
  return value.replace(/^#/, "");
}

export function parseWorkIssueQueue(input: string): string[] {
  const match = input.match(/^\/work-issue(?:\s+|$)([\s\S]*)$/i);
  if (!match) return [];
  const args = match[1] ?? "";
  const issues: string[] = [];
  const tokenPattern = /https?:\/\/[^\s]+\/issues\/(\d+)|#(\d+)|(?:^|\s)(\d+)(?=\s|$)/g;
  for (const token of args.matchAll(tokenPattern)) {
    const issue = token[1] ?? token[2] ?? token[3];
    if (issue && !issues.includes(issue)) issues.push(issue);
  }
  return issues;
}

export function applyWorkflowCheckpoint(state: WorkIssueState, checkpoint: Checkpoint): WorkIssueState {
  const next: WorkIssueState = {
    ...state,
    lastSummary: checkpoint.summary,
    updatedAt: Date.now(),
  };
  if (checkpoint.status === "progress") {
    next.stalledContinuations = 0;
    return next;
  }
  if (checkpoint.status === "human-gate") {
    next.phase = "blocked";
    next.blocker = checkpoint.blocker || checkpoint.summary;
    return next;
  }
  if (checkpoint.status === "queue-completed") {
    next.phase = "completed";
    next.remaining = [];
    next.stalledContinuations = 0;
    return next;
  }

  const completed = normalizeIssue(checkpoint.issue ?? next.remaining[0] ?? "");
  const index = next.remaining.indexOf(completed);
  if (index >= 0) next.remaining = next.remaining.filter((_, itemIndex) => itemIndex !== index);
  if (next.remaining.length === 0) next.phase = "completed";
  next.stalledContinuations = 0;
  return next;
}

function lastAssistantMessage(entries: readonly any[]): AssistantMessage | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message?.role === "assistant") return entry.message as AssistantMessage;
  }
  return undefined;
}

export default function workIssueAutopilot(pi: ExtensionAPI) {
  let state: WorkIssueState | undefined;
  let followUpQueued = false;

  const persist = () => {
    if (state) pi.appendEntry(STATE_TYPE, state);
  };

  pi.registerTool({
    name: "work_issue_checkpoint",
    label: "Work Issue Checkpoint",
    description: "Record deterministic progress for an active /work-issue queue. Use human-gate only for a documented autopilot decision gate.",
    promptSnippet: "Record progress, completed issues, human gates, or completion for an active /work-issue queue",
    promptGuidelines: [
      "When /work-issue is active, call work_issue_checkpoint after meaningful progress, after each merged issue, at a real human decision gate, and when the full queue is complete.",
      "Do not end a /work-issue turn at branch, commit, push, PR creation, or one issue merge while work_issue_checkpoint reports remaining issues.",
      "Do not report tool unavailability unless a real tool result returned an error; hidden bootstrap calls do not block normal repository tools.",
    ],
    parameters: Type.Object({
      status: StringEnum(["progress", "issue-completed", "human-gate", "queue-completed"] as const),
      issue: Type.Optional(Type.String()),
      summary: Type.String(),
      blocker: Type.Optional(Type.String()),
    }),
    async execute(_id, checkpoint) {
      if (!state || state.phase !== "active") {
        return { content: [{ type: "text", text: "No active /work-issue queue." }], details: { state } };
      }
      state = applyWorkflowCheckpoint(state, checkpoint);
      persist();
      return {
        content: [{ type: "text", text: JSON.stringify({ phase: state.phase, remaining: state.remaining, summary: state.lastSummary, blocker: state.blocker }) }],
        details: { state },
      };
    },
  });

  pi.registerCommand("autopilot-status", {
    description: "Show the active /work-issue runtime guard state",
    handler: async (_args, ctx) => ctx.ui.notify(state ? JSON.stringify(state, null, 2) : "No active /work-issue queue", "info"),
  });

  pi.registerCommand("autopilot-stop", {
    description: "Stop the active /work-issue runtime guard",
    handler: async (_args, ctx) => {
      if (state) {
        state = { ...state, phase: "stopped", updatedAt: Date.now() };
        persist();
      }
      ctx.ui.notify("Work-issue runtime guard stopped", "warning");
    },
  });

  pi.on("input", (event) => {
    if (event.source === "extension") return;
    const queue = parseWorkIssueQueue(event.text);
    if (queue.length === 0) return;
    state = {
      queue,
      remaining: [...queue],
      phase: "active",
      stalledContinuations: 0,
      updatedAt: Date.now(),
    };
    followUpQueued = false;
    persist();
  });

  pi.on("session_start", async (_event, ctx) => {
    state = undefined;
    followUpQueued = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === STATE_TYPE) state = entry.data as WorkIssueState;
    }
  });

  pi.on("agent_start", () => {
    followUpQueued = false;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!state || state.phase !== "active" || followUpQueued || ctx.hasPendingMessages()) return;
    const assistant = lastAssistantMessage(ctx.sessionManager.getBranch());
    if (!assistant || assistant.stopReason === "error" || assistant.stopReason === "aborted") return;
    if (state.stalledContinuations >= MAX_STALLED_CONTINUATIONS) {
      state = {
        ...state,
        phase: "blocked",
        blocker: `runtime guard stopped after ${MAX_STALLED_CONTINUATIONS} continuations without a progress checkpoint`,
        updatedAt: Date.now(),
      };
      persist();
      if (ctx.hasUI) ctx.ui.notify(state.blocker, "warning");
      return;
    }

    state = { ...state, stalledContinuations: state.stalledContinuations + 1, updatedAt: Date.now() };
    persist();
    followUpQueued = true;
    pi.sendMessage({
      customType: "work-issue-autopilot-continuation",
      content: [
        "The explicit /work-issue queue is still active.",
        `Remaining issues: ${state.remaining.map((issue) => `#${issue}`).join(", ") || "checkpoint required"}.`,
        "Continue repository work now in the same queue order. Do not stop at an intermediate artifact.",
        "Call work_issue_checkpoint after meaningful progress, on a real human gate, after each merged issue, or when the queue is complete.",
      ].join("\n"),
      display: true,
      details: { state },
    }, { triggerTurn: true, deliverAs: "followUp" });
  });
}
