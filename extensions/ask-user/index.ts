import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component, type Theme } from "@earendil-works/pi-tui";

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
    if (!this.allowCustom || this.options.includes("其他")) return this.options;
    return [...this.options, "其他"];
  }

  private get customOptionIndex(): number {
    return this.allowCustom ? this.displayOptions.indexOf("其他") : -1;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    const line = (text: string) => truncateToWidth(text, safeWidth, "");
    const lines = [
      line(this.theme.fg("accent", this.theme.bold(`? ${this.question}`))),
      "",
    ];
    this.displayOptions.forEach((option, index) => {
      const prefix = index === this.selected ? this.theme.fg("accent", "❯ ") : "  ";
      lines.push(line(`${prefix}${option}`));
    });
    if (this.mode === "custom") {
      lines.push(line(this.theme.fg("accent", "› ") + truncateToWidth(this.customText, Math.max(0, safeWidth - 2), "")));
      lines.push(line(this.theme.fg("muted", "输入内容 · Enter 确认 · Esc 取消")));
    } else {
      lines.push(line(this.theme.fg("muted", "↑/↓ 选择 · Enter 确认 · 直接输入自定义内容 · Esc 取消")));
    }
    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done({ mode: "cancelled" });
      return;
    }
    if (this.mode === "custom") {
      if (matchesKey(data, Key.enter)) {
        const selectedOption = this.selected < this.options.length
          ? { optionIndex: this.selected, option: this.options[this.selected] }
          : {};
        this.done({ mode: "custom", ...selectedOption, text: this.customText });
      } else if (matchesKey(data, Key.backspace)) {
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
        this.customText = "";
      } else {
        this.done({ mode: "choice", optionIndex: this.selected, option: this.options[this.selected] });
      }
      return;
    }
    // Direct typing starts an input row without hiding the selectable options.
    if (this.allowCustom && !data.startsWith("\x1b") && data.length > 0) {
      this.mode = "custom";
      this.customText += data;
    }
  }

  invalidate(): void {}
}

let activeRequest = false;

export default function askUserExtension(pi: ExtensionAPI): void {
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
