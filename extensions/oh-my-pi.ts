import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SlashCommandInfo, ToolInfo } from "@earendil-works/pi-coding-agent";
import { runModelRelayWizard } from "./model-relay";
import { showTavilyPoolStatus } from "./tavily-tools";

type ToolsState = {
  enabledTools: string[];
};

type MenuItem =
  | "Tools"
  | "Commands"
  | "Skills"
  | "Extensions"
  | "Remote devices"
  | "Model relays"
  | "RTK setup"
  | "Tavily status";

const MENU_ITEMS: MenuItem[] = ["Tools", "Commands", "Skills", "Extensions", "Remote devices", "Model relays", "RTK setup", "Tavily status"];
const ARG_ALIASES: Record<string, MenuItem> = {
  tools: "Tools",
  commands: "Commands",
  skills: "Skills",
  extensions: "Extensions",
  remote: "Remote devices",
  devices: "Remote devices",
  relays: "Model relays",
  rtk: "RTK setup",
  tavily: "Tavily status",
};

function formatCommand(command: SlashCommandInfo): string {
  const desc = command.description ? ` - ${command.description}` : "";
  return `/${command.name}${desc}`;
}

function commandNameFromItem(item: string): string {
  return item.split(" - ")[0].slice(1);
}

function uniquePaths(commands: SlashCommandInfo[]): string[] {
  return [...new Set(commands.map((command) => command.sourceInfo?.path).filter((path): path is string => Boolean(path)))];
}

function getToolLabel(tool: ToolInfo, enabled: boolean): string {
  return `${enabled ? "[x]" : "[ ]"} ${tool.name}`;
}

function restoreToolsFromBranch(pi: ExtensionAPI, ctx: ExtensionContext, enabledTools: Set<string>) {
  const allTools = pi.getAllTools();
  const allToolNames = allTools.map((tool) => tool.name);
  const branchEntries = ctx.sessionManager.getBranch();
  let savedTools: string[] | undefined;

  for (const entry of branchEntries) {
    if (entry.type === "custom" && entry.customType === "oh-my-pi-tools-config") {
      const data = entry.data as ToolsState | undefined;
      if (data?.enabledTools) savedTools = data.enabledTools;
    }
  }

  if (savedTools) {
    enabledTools.clear();
    for (const toolName of savedTools.filter((name) => allToolNames.includes(name))) enabledTools.add(toolName);
    pi.setActiveTools(Array.from(enabledTools));
    return;
  }

  enabledTools.clear();
  for (const toolName of pi.getActiveTools()) enabledTools.add(toolName);
}

async function showTools(pi: ExtensionAPI, ctx: ExtensionCommandContext, enabledTools: Set<string>) {
  while (true) {
    const allTools = pi.getAllTools();
    if (allTools.length === 0) {
      ctx.ui.notify("No tools registered", "info");
      return;
    }

    const selected = await ctx.ui.select("Tools", [
      ...allTools.map((tool) => getToolLabel(tool, enabledTools.has(tool.name))),
      "Done",
    ]);
    if (!selected || selected === "Done") return;

    const toolName = selected.replace(/^\[[ x]\] /, "");
    if (enabledTools.has(toolName)) enabledTools.delete(toolName);
    else enabledTools.add(toolName);

    pi.setActiveTools(Array.from(enabledTools));
    pi.appendEntry<ToolsState>("oh-my-pi-tools-config", { enabledTools: Array.from(enabledTools) });
  }
}

async function showCommands(pi: ExtensionAPI, ctx: ExtensionCommandContext, source?: "extension" | "prompt" | "skill") {
  const commands = pi.getCommands();
  const filtered = source ? commands.filter((command) => command.source === source) : commands;
  if (filtered.length === 0) {
    ctx.ui.notify(source ? `No ${source} commands found` : "No commands found", "info");
    return;
  }

  const items = filtered.map(formatCommand);
  const selected = await ctx.ui.select(source ? `${source} commands` : "Commands", items);
  if (!selected) return;

  const command = filtered.find((candidate) => candidate.name === commandNameFromItem(selected));
  if (!command) return;

  const path = command.sourceInfo?.path;
  const sourceInfo = path ? `\n\n${path}` : "";
  ctx.ui.notify(`/${command.name}\n${command.description ?? "No description"}${sourceInfo}`, "info");
}

async function showExtensions(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const extensionCommands = pi.getCommands().filter((command) => command.source === "extension");
  const paths = uniquePaths(extensionCommands);
  if (paths.length === 0) {
    ctx.ui.notify("No extension commands found", "info");
    return;
  }

  const selected = await ctx.ui.select("Extensions", paths);
  if (!selected) return;

  const commands = extensionCommands.filter((command) => command.sourceInfo?.path === selected);
  const details = commands.length > 0
    ? commands.map((command) => `/${command.name}${command.description ? ` - ${command.description}` : ""}`).join("\n")
    : "No commands registered by this extension";
  ctx.ui.notify(`${selected}\n\n${details}`, "info");
}

async function showRemoteDevices(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const remoteTools = pi.getAllTools().filter((tool) => tool.name.startsWith("remote_"));
  const remoteCommand = pi.getCommands().find((command) => command.name === "remote-devices");
  const lines = [
    remoteCommand ? `Command: /${remoteCommand.name}` : "Command: /remote-devices not loaded",
    remoteTools.length > 0 ? `Tools: ${remoteTools.map((tool) => tool.name).join(", ")}` : "Tools: none loaded",
    "Common: /remote-devices list | /remote-devices probe | /remote-devices test <device>",
  ];
  ctx.ui.notify(lines.join("\n"), remoteCommand && remoteTools.length > 0 ? "info" : "warning");
}

async function showRtkSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const ok = await ctx.ui.confirm("RTK setup", "Run rtk init -g --agent pi? This writes global pi configuration.");
  if (!ok) return;

  try {
    const result = await pi.exec("rtk", ["init", "-g", "--agent", "pi"], { timeout: 30_000 });
    if (result.code === 0) {
      ctx.ui.notify("rtk init -g --agent pi completed", "info");
      return;
    }
    ctx.ui.notify(`rtk init failed: ${result.stderr || result.stdout || `exit ${result.code}`}`, "error");
  } catch (error) {
    ctx.ui.notify(`rtk init failed: ${(error as Error).message}`, "error");
  }
}

async function showTavilyStatus(ctx: ExtensionCommandContext) {
  showTavilyPoolStatus(ctx);
}

async function runMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext, item: MenuItem, args: string, enabledTools: Set<string>) {
  switch (item) {
    case "Tools":
      await showTools(pi, ctx, enabledTools);
      break;
    case "Commands":
      await showCommands(pi, ctx);
      break;
    case "Skills":
      await showCommands(pi, ctx, "skill");
      break;
    case "Extensions":
      await showExtensions(pi, ctx);
      break;
    case "Remote devices":
      await showRemoteDevices(pi, ctx);
      break;
    case "Model relays":
      await runModelRelayWizard(ctx, args);
      break;
    case "RTK setup":
      await showRtkSetup(pi, ctx);
      break;
    case "Tavily status":
      await showTavilyStatus(ctx);
      break;
  }
}

export default function ohMyPiExtension(pi: ExtensionAPI) {
  const enabledTools = new Set<string>();

  pi.registerCommand("oh-my-pi", {
    description: "Open the oh-my-pi local capability console",
    getArgumentCompletions: (prefix) => {
      const values = Object.keys(ARG_ALIASES).filter((value) => value.startsWith(prefix.trim()));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const [firstArg, ...rest] = trimmed.split(/\s+/).filter(Boolean);
      const directItem = firstArg ? ARG_ALIASES[firstArg.toLowerCase()] : undefined;
      const item = directItem ?? (await ctx.ui.select("oh-my-pi", MENU_ITEMS));
      if (!item) return;

      await runMenu(pi, ctx, item, rest.join(" "), enabledTools);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    restoreToolsFromBranch(pi, ctx, enabledTools);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreToolsFromBranch(pi, ctx, enabledTools);
  });
}
