import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SlashCommandInfo, ToolInfo } from "@earendil-works/pi-coding-agent";
import { runModelRelayWizard } from "./model-relay";
import { showTavilyPoolStatus } from "./tavily-tools";
import { showOhMyPiStatusBar } from "./status-bar";
import { showRtkAdapter } from "./rtk-adapter";

type ToolsState = {
  enabledTools: string[];
};

type DoctorSeverity = "pass" | "warn" | "fail";

type DoctorCheck = {
  severity: DoctorSeverity;
  label: string;
  detail?: string;
};

type MenuItem =
  | "Tools"
  | "Commands"
  | "Skills"
  | "Extensions"
  | "Remote devices"
  | "Status bar"
  | "Doctor"
  | "Model relays"
  | "RTK setup"
  | "Tavily status";

const MENU_ITEMS: MenuItem[] = ["Tools", "Commands", "Skills", "Extensions", "Remote devices", "Status bar", "Doctor", "Model relays", "RTK setup", "Tavily status"]; 
const ARG_ALIASES: Record<string, MenuItem> = {
  tools: "Tools",
  commands: "Commands",
  skills: "Skills",
  extensions: "Extensions",
  remote: "Remote devices",
  devices: "Remote devices",
  status: "Status bar",
  statusbar: "Status bar",
  "status-bar": "Status bar",
  doctor: "Doctor",
  relays: "Model relays",
  rtk: "RTK setup",
  tavily: "Tavily status",
};

const DOCTOR_SCAN_EXCLUDES = new Set([".git", ".pi", "node_modules", "packages", "package-lock.json"]);
const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "private key marker", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/ },
  { label: "private host/IP example", pattern: /\b(?:10\.110\.\d{1,3}\.\d{1,3}|192\.168\.41\.\d{1,3}|139\.196\.\d{1,3}\.\d{1,3}|100\.100\.\d{1,3}\.\d{1,3})\b/ },
];

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

function truncateDetail(value: string, max = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function packageRoot(): string {
  return process.cwd();
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (DOCTOR_SCAN_EXCLUDES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function parseSkillFrontmatter(text: string): Record<string, string> | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return undefined;
  const raw = text.slice(4, end).trim();
  const data: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    data[match[1]] = match[2].trim().replace(/^['\"]|['\"]$/g, "");
  }
  return data;
}

async function checkPackageLoads(pi: ExtensionAPI, root: string): Promise<DoctorCheck> {
  try {
    const result = await pi.exec("pi", ["-e", root, "--list-models"], { timeout: 30_000 });
    if (result.code === 0) return { severity: "pass", label: "package loads" };
    return { severity: "fail", label: "package load failed", detail: truncateDetail(result.stderr || result.stdout || `exit ${result.code}`) };
  } catch (error) {
    return { severity: "fail", label: "package load failed", detail: truncateDetail((error as Error).message) };
  }
}

function checkRegistration(pi: ExtensionAPI): DoctorCheck[] {
  const commands = pi.getCommands();
  const tools = pi.getAllTools();
  const commandNames = new Set(commands.map((command) => command.name));
  const toolNames = new Set(tools.map((tool) => tool.name));
  const checks: DoctorCheck[] = [];

  checks.push(commandNames.has("oh-my-pi")
    ? { severity: "pass", label: "/oh-my-pi command registered" }
    : { severity: "fail", label: "/oh-my-pi command missing" });

  checks.push(commandNames.has("remote-devices")
    ? { severity: "pass", label: "/remote-devices command registered" }
    : { severity: "warn", label: "/remote-devices command missing" });

  checks.push(commandNames.has("status-bar")
    ? { severity: "pass", label: "/status-bar command registered" }
    : { severity: "warn", label: "/status-bar command missing" });

  checks.push(commandNames.has("rtk-adapter")
    ? { severity: "pass", label: "/rtk-adapter command registered" }
    : { severity: "warn", label: "/rtk-adapter command missing" });

  const expectedRemoteTools = ["remote_list_devices", "remote_resolve_device", "remote_exec", "remote_exec_batch", "remote_probe_devices", "remote_test_connection", "remote_add_device", "remote_learn_alias", "remote_install_keys"];
  const missingRemoteTools = expectedRemoteTools.filter((name) => !toolNames.has(name));
  checks.push(missingRemoteTools.length === 0
    ? { severity: "pass", label: "remote-devices tools registered" }
    : { severity: "warn", label: "remote-devices tools missing", detail: missingRemoteTools.join(", ") });

  return checks;
}

function checkRemoteSeed(root: string): DoctorCheck {
  const seedPath = path.join(root, "extensions", "remote-devices", "devices.json");
  if (!fs.existsSync(seedPath)) return { severity: "warn", label: "remote-devices seed missing" };
  try {
    const data = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    const count = Array.isArray(data.devices) ? data.devices.length : 0;
    if (count === 0) return { severity: "pass", label: "remote-devices seed has 0 devices" };
    return { severity: "fail", label: "remote-devices seed contains devices", detail: `${count} device(s)` };
  } catch (error) {
    return { severity: "fail", label: "remote-devices seed parse failed", detail: truncateDetail((error as Error).message) };
  }
}

function checkRuntimeConfigBoundary(root: string): DoctorCheck {
  const runtimePath = path.join(os.homedir(), ".pi", "agent", "remote-devices", "devices.json");
  if (!fs.existsSync(runtimePath)) return { severity: "warn", label: "remote-devices runtime config not found", detail: runtimePath };
  const resolvedRoot = fs.realpathSync(root);
  const resolvedRuntime = fs.realpathSync(runtimePath);
  if (isInside(resolvedRoot, resolvedRuntime) || resolvedRoot === resolvedRuntime) {
    return { severity: "fail", label: "remote-devices runtime config is inside package checkout", detail: resolvedRuntime };
  }
  return { severity: "pass", label: "remote-devices runtime config outside repo" };
}

function checkSensitiveContent(root: string): DoctorCheck {
  const maxMatches = 5;
  const maxFileSizeBytes = 1024 * 1024;
  const matches: string[] = [];

  for (const file of walkFiles(root)) {
    if (matches.length >= maxMatches) break;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    if (!stat.isFile() || stat.size > maxFileSizeBytes) continue;

    const relative = path.relative(root, file);
    if (!/\.(?:ts|js|json|md|yml|yaml|toml|txt|rs)$/.test(relative)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (!pattern.test(text)) continue;
      matches.push(`${relative}: ${label}`);
      if (matches.length >= maxMatches) break;
    }
  }

  if (matches.length === 0) return { severity: "pass", label: "sensitive content scan clean" };
  return { severity: "fail", label: "sensitive content scan found matches", detail: matches.join("; ") };
}

function checkSkillFrontmatter(root: string): DoctorCheck {
  const skillsDir = path.join(root, "skills");
  if (!fs.existsSync(skillsDir)) return { severity: "warn", label: "skills directory not found" };
  const failures: string[] = [];
  for (const skillName of fs.readdirSync(skillsDir)) {
    const skillPath = path.join(skillsDir, skillName, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const frontmatter = parseSkillFrontmatter(fs.readFileSync(skillPath, "utf8"));
    if (!frontmatter?.name || !frontmatter?.description) failures.push(path.relative(root, skillPath));
  }
  if (failures.length === 0) return { severity: "pass", label: "skill frontmatter valid" };
  return { severity: "fail", label: "skill frontmatter invalid", detail: failures.join(", ") };
}

function overallSeverity(checks: DoctorCheck[]): DoctorSeverity {
  if (checks.some((check) => check.severity === "fail")) return "fail";
  if (checks.some((check) => check.severity === "warn")) return "warn";
  return "pass";
}

function formatDoctorReport(checks: DoctorCheck[]): string {
  const status = overallSeverity(checks);
  const symbol: Record<DoctorSeverity, string> = { pass: "✓", warn: "!", fail: "×" };
  const groups: DoctorSeverity[] = ["pass", "warn", "fail"];
  const lines = [`oh-my-pi doctor: ${status}`, ""];
  for (const group of groups) {
    const items = checks.filter((check) => check.severity === group);
    if (items.length === 0) continue;
    lines.push(group);
    for (const item of items) {
      lines.push(`${symbol[group]} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function runDoctor(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const root = packageRoot();
  const checks: DoctorCheck[] = [
    await checkPackageLoads(pi, root),
    ...checkRegistration(pi),
    checkRemoteSeed(root),
    checkRuntimeConfigBoundary(root),
    checkSensitiveContent(root),
    checkSkillFrontmatter(root),
  ];
  const status = overallSeverity(checks);
  ctx.ui.notify(formatDoctorReport(checks), status === "fail" ? "error" : status === "warn" ? "warning" : "info");
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
  await showRtkAdapter(pi, ctx);
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
    case "Status bar":
      showOhMyPiStatusBar(ctx);
      break;
    case "Doctor":
      await runDoctor(pi, ctx);
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
