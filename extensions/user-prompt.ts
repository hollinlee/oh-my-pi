import {
  CustomEditor,
  type EditorTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";

export const PROMPT_PREFIX = " ❯ ";
export const PROMPT_PADDING_X = visibleWidth(PROMPT_PREFIX);

export function promptForPadding(padding: number): string {
  const width = Math.max(0, Math.floor(padding));
  if (width === 0) return "";
  if (width < PROMPT_PADDING_X) return "❯ ".slice(0, width);
  return PROMPT_PREFIX + " ".repeat(width - PROMPT_PADDING_X);
}

export function addPromptPrefix(line: string, padding = PROMPT_PADDING_X): string {
  const reserved = " ".repeat(Math.max(0, Math.floor(padding)));
  if (!reserved || !line.startsWith(reserved)) return line;
  return promptForPadding(padding) + line.slice(reserved.length);
}

export function decorateEditorLines(
  lines: string[],
  padding = PROMPT_PADDING_X,
  firstLogicalLineVisible = true,
): string[] {
  if (firstLogicalLineVisible && lines.length > 1) lines[1] = addPromptPrefix(lines[1] ?? "", padding);
  return lines;
}

export function fitPromptLine(line: string, width: number): string {
  return visibleWidth(line) <= width ? line : truncateToWidth(line, Math.max(0, width), "");
}

class PromptEditor extends CustomEditor {
  private hiddenTopLines = 0;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings, { paddingX: PROMPT_PADDING_X });
  }

  override setPaddingX(_padding: number): void {
    super.setPaddingX(PROMPT_PADDING_X);
  }

  protected override renderTopBorder(width: number, hiddenLineCount: number): string {
    this.hiddenTopLines = hiddenLineCount;
    return super.renderTopBorder(width, hiddenLineCount);
  }

  override render(width: number): string[] {
    this.hiddenTopLines = 0;
    const padding = Math.min(PROMPT_PADDING_X, Math.max(0, Math.floor((width - 1) / 2)));
    const lines = super.render(width);
    return decorateEditorLines(lines, padding, this.hiddenTopLines === 0)
      .map((line) => fitPromptLine(line, width));
  }
}

export default function userPromptRenderer(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings));
  });
}
