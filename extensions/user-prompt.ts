import {
  CustomEditor,
  type EditorTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export function addPromptPrefix(line: string): string {
  return line.startsWith(" ") ? `❯${line}` : line;
}

class PromptEditor extends CustomEditor {
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings, { paddingX: 1 });
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length > 1 && lines[1]?.startsWith(" ")) {
      lines[1] = addPromptPrefix(lines[1]);
    }
    return lines;
  }
}

export default function userPromptRenderer(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings));
  });
}
