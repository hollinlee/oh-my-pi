import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type Theme } from "@earendil-works/pi-tui";

export const AskUserParameters = Type.Object({
  question: Type.String({ description: "The single decision question to ask the user." }),
  options: Type.Array(Type.String(), { minItems: 1, description: "Ordered single-choice options." }),
  allow_custom: Type.Optional(Type.Boolean({ description: "Allow a free-form answer in addition to the options." })),
});

export type AskUserParameters = Static<typeof AskUserParameters>;
export type AskUserMode = "choice" | "custom" | "cancelled" | "needs_user_input";
export interface AskUserAnswer {
  mode: AskUserMode;
  optionIndex?: number;
  option?: string;
  text?: string;
}

export function formatAskUserAnswer(answer: AskUserAnswer): string {
  if (answer.mode === "choice") return `用户选择：${answer.option ?? ""}`;
  if (answer.mode === "custom") return `用户自定义回答：${answer.text ?? ""}`;
  if (answer.mode === "cancelled") return "用户取消了当前问题。";
  return "需要用户输入后才能继续。";
}

export class ChoicePrompt implements Component {
  private selected = 0;
  private customText = "";
  private mode: "choice" | "custom" = "choice";
  private readonly done: (answer: AskUserAnswer) => void;
  private readonly theme: Pick<Theme, "fg" | "bold">;
  private readonly question: string;
  private readonly options: readonly string[];
  private readonly allowCustom: boolean;

  constructor(
    question: string,
    options: readonly string[],
    allowCustom: boolean,
    theme: Pick<Theme, "fg" | "bold">,
    done: (answer: AskUserAnswer) => void,
  ) {
    this.question = question;
    this.options = options;
    this.allowCustom = allowCustom;
    this.theme = theme;
    this.done = done;
  }

  private get displayOptions(): readonly string[] {
    const options = [...this.options];
    if (!this.allowCustom) return options;
    const otherIndex = options.indexOf("其他");
    if (otherIndex >= 0) options.splice(otherIndex, 1);
    return [...options, "其他"];
  }

  private get customOptionIndex(): number {
    return this.allowCustom ? this.displayOptions.length - 1 : -1;
  }

  private get customOptionLabel(): string {
    return this.customText ? `其他：${this.customText}` : "其他：";
  }

  private wrap(text: string, width: number): string[] {
    const safeWidth = Math.max(1, width);
    const lines: string[] = [];
    let current = "";
    for (const char of text) {
      if (current && visibleWidth(current + char) > safeWidth) {
        lines.push(current);
        current = "";
      }
      current += char;
    }
    lines.push(current);
    return lines;
  }

  private optionLines(option: string, index: number, width: number): string[] {
    const prefix = index === this.selected ? this.theme.fg("accent", "❯ ") : "  ";
    const continuation = "  ";
    const chunks = this.wrap(option, Math.max(1, width - visibleWidth(prefix)));
    return chunks.map((chunk, lineIndex) => `${lineIndex === 0 ? prefix : continuation}${chunk}`);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const lines: string[] = [];
    for (const questionLine of this.wrap(`? ${this.question}`, safeWidth)) {
      lines.push(this.theme.fg("accent", this.theme.bold(questionLine)));
    }
    lines.push("");
    this.displayOptions.forEach((option, index) => {
      const label = index === this.customOptionIndex ? this.customOptionLabel : option;
      for (const optionLine of this.optionLines(label, index, safeWidth)) lines.push(optionLine);
    });
    lines.push(...this.wrap(this.mode === "custom"
      ? "输入内容 · ↑/↓ 切换选项 · Enter 确认 · Esc 取消"
      : "↑/↓ 选择 · Enter 确认 · 直接输入自定义内容 · Esc 取消", safeWidth).map((line) => this.theme.fg("muted", line)));
    return lines.map((line) => truncateToWidth(line, safeWidth, ""));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done({ mode: "cancelled" });
      return;
    }
    if (this.mode === "custom") {
      if (matchesKey(data, Key.up)) {
        this.selected = this.selected === 0 ? this.displayOptions.length - 1 : this.selected - 1;
        return;
      }
      if (matchesKey(data, Key.down)) {
        this.selected = this.selected === this.displayOptions.length - 1 ? 0 : this.selected + 1;
        return;
      }
      if (matchesKey(data, Key.enter)) {
        if (this.selected === this.customOptionIndex) {
          this.done({ mode: "custom", text: this.customText });
        } else {
          this.done({ mode: "choice", optionIndex: this.selected, option: this.options[this.selected] });
        }
        return;
      }
      if (matchesKey(data, Key.backspace)) {
        this.customText = this.customText.slice(0, -1);
      } else if (!data.startsWith("\x1b") && data.length > 0) {
        this.customText += data;
      }
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selected = this.selected === 0 ? this.displayOptions.length - 1 : this.selected - 1;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selected = this.selected === this.displayOptions.length - 1 ? 0 : this.selected + 1;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (this.selected === this.customOptionIndex) {
        this.mode = "custom";
      } else {
        this.done({ mode: "choice", optionIndex: this.selected, option: this.options[this.selected] });
      }
      return;
    }
    // Direct typing starts an input row without hiding the selectable options.
    if (this.allowCustom && !data.startsWith("\x1b") && data.length > 0) {
      this.mode = "custom";
      this.selected = this.customOptionIndex;
      this.customText += data;
    }
  }

  invalidate(): void {}
}

let activeRequest = false;
let askUserCalledThisTurn = false;
let enforcementAttemptedThisTurn = false;

function assistantText(messages: readonly AgentMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "assistant");
  if (!message || message.role !== "assistant") return "";
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
}

export function likelyBlockingChoice(text: string): boolean {
  if (!text || text.length > 1200) return false;
  const hasQuestion = /[?？]/.test(text);
  const hasChoiceLanguage = /(请选择|请确认|是否|要不要|你希望|哪个|哪一个|选择|确认后|决定)/.test(text);
  const hasOptions = /(^|\n)\s*(\d+[.)]|[-*]|选项|方案|option)/im.test(text);
  return hasQuestion && hasChoiceLanguage && (hasOptions || /(还是|或是|同意|拒绝|继续|取消)/.test(text));
}

export function shouldEnforceAskUser(text: string, calledThisTurn: boolean, attemptedThisTurn: boolean): boolean {
  return !calledThisTurn && !attemptedThisTurn && likelyBlockingChoice(text);
}
export default function askUserExtension(pi: ExtensionAPI): void {
  pi.on("input", () => {
    askUserCalledThisTurn = false;
    enforcementAttemptedThisTurn = false;
  });
  pi.on("tool_call", (event) => {
    if (event.toolName === "ask_user") askUserCalledThisTurn = true;
  });
  pi.on("agent_before_settle", (event) => {
    if (!shouldEnforceAskUser(assistantText(event.context.contextMessages as AgentMessage[]), askUserCalledThisTurn, enforcementAttemptedThisTurn)) return;
    enforcementAttemptedThisTurn = true;
    return {
      entries: [{
        type: "custom_message",
        customType: "oh-my-pi.ask-user-enforcement",
        content: "The assistant appears to be asking the user to make a blocking choice without using ask_user. Before finishing, call ask_user with one focused question and concise options. Do not ask the question only in prose.",
        display: false,
      }],
      continue: true,
    };
  });

  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description: "Ask the user one focused single-choice question. Use this for a blocking decision in a complex task; keep the options concise and provide a free-form path when useful.",
    promptSnippet: "Ask the user one focused question with keyboard-selectable options",
    promptGuidelines: [
      "Ask only one blocking decision at a time.",
      "Use options for distinct choices and set allow_custom when the user may answer outside the options.",
      "Do not use this tool for ordinary explanatory lists or questions that do not block the next step.",
    ],
    parameters: AskUserParameters,
    async execute(_toolCallId, params: AskUserParameters, _signal, _onUpdate, ctx: ExtensionContext) {
      if (activeRequest) {
        return { content: [{ type: "text", text: JSON.stringify({ mode: "needs_user_input", reason: "another user interaction is active" }) }], isError: true };
      }
      if (ctx.mode !== "tui") {
        return { content: [{ type: "text", text: JSON.stringify({ mode: "needs_user_input", question: params.question, options: params.options }) }] };
      }
      activeRequest = true;
      try {
        const answer = await ctx.ui.custom<AskUserAnswer>((_tui, theme, _keybindings, done) =>
          new ChoicePrompt(params.question, params.options, params.allow_custom ?? true, theme, done),
          { overlay: false },
        );
        return { content: [{ type: "text", text: JSON.stringify({ ...answer, readable: formatAskUserAnswer(answer) }) }], details: answer };
      } finally {
        activeRequest = false;
      }
    },
  });
}
