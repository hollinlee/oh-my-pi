import fs from "node:fs";
import path from "node:path";
import {
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { limitImageContent } from "../image-result-limiter.ts";
import { BUDGETS } from "./budgets.ts";
import { limitTextOutput } from "./output-limits.ts";
import type { SubagentTask } from "./schemas.ts";

export class CapabilityViolation extends Error {
  readonly code = "SUBAGENT_PERMISSION_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "CapabilityViolation";
  }
}

function existingAncestor(input: string): string {
  let current = input;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function canonicalTarget(input: string): string {
  const resolved = path.resolve(input);
  const ancestor = existingAncestor(resolved);
  const canonicalAncestor = fs.realpathSync.native(ancestor);
  return path.join(canonicalAncestor, path.relative(ancestor, resolved));
}

function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function scopedRoots(cwd: string, paths: string[] | undefined, defaultToCwd: boolean): string[] {
  const values = paths && paths.length > 0 ? paths : defaultToCwd ? ["."] : [];
  return values.map((value) => canonicalTarget(path.resolve(cwd, value)));
}

export type PathPolicy = {
  cwd: string;
  includeRoots: string[];
  excludeRoots: string[];
  assertPath(input: string, operation: "read" | "write"): string;
};

export function createPathPolicy(task: SubagentTask, sessionCwd: string): PathPolicy {
  const cwd = canonicalTarget(sessionCwd);
  const includeRoots = scopedRoots(cwd, task.scope.includePaths, true);
  const excludeRoots = scopedRoots(cwd, task.scope.excludePaths, false);
  if (!task.capability.overrides?.includes("repo-outside") && includeRoots.some((root) => !contains(cwd, root))) {
    throw new CapabilityViolation("repo-outside override is required for include paths outside cwd");
  }
  return {
    cwd,
    includeRoots,
    excludeRoots,
    assertPath(input, operation) {
      const target = canonicalTarget(path.resolve(cwd, input.replace(/^@/, "")));
      if (!includeRoots.some((root) => contains(root, target))) {
        throw new CapabilityViolation(`${operation} outside allowed scope: ${input}`);
      }
      if (excludeRoots.some((root) => contains(root, target))) {
        throw new CapabilityViolation(`${operation} denied by excluded scope: ${input}`);
      }
      return target;
    },
  };
}

function wrapPathTool(tool: ToolDefinition, policy: PathPolicy, operation: "read" | "write", maxOutputBytes: number): ToolDefinition {
  return {
    ...tool,
    async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      if (typeof params.path !== "string") throw new CapabilityViolation("tool path is required");
      policy.assertPath(params.path, operation);
      const result = await tool.execute(id, params, signal, onUpdate, ctx);
      const textLimited = operation === "read" ? { ...result, content: limitTextOutput(result.content, maxOutputBytes) } : result;
      if (operation !== "read" || process.env.OH_MY_PI_IMAGE_LIMIT_DISABLED === "1" || !textLimited.content.some((part: any) => part.type === "image")) return textLimited;
      const maxBinaryBytes = Number(process.env.OH_MY_PI_IMAGE_MAX_BYTES) || undefined;
      const maxEdge = Number(process.env.OH_MY_PI_IMAGE_MAX_EDGE) || undefined;
      const limited = limitImageContent(textLimited.content as any[], { maxBinaryBytes, maxEdge });
      if (limited.summary.changed === 0) return textLimited;
      return {
        ...textLimited,
        content: limited.content,
        details: { ...(textLimited.details && typeof textLimited.details === "object" ? textLimited.details : {}), imageLimiter: limited.summary },
      };
    },
  } as ToolDefinition;
}

export function createScopedFileTools(task: SubagentTask, sessionCwd: string): ToolDefinition[] {
  const policy = createPathPolicy(task, sessionCwd);
  const maxOutputBytes = BUDGETS[task.budget ?? "small"].toolResultBytes;
  const tools: ToolDefinition[] = [
    wrapPathTool(createReadTool(policy.cwd), policy, "read", maxOutputBytes),
    wrapPathTool(createGrepTool(policy.cwd), policy, "read", maxOutputBytes),
    wrapPathTool(createFindTool(policy.cwd), policy, "read", maxOutputBytes),
    wrapPathTool(createLsTool(policy.cwd), policy, "read", maxOutputBytes),
  ];
  if (task.capability.profile !== "read-only") {
    tools.push(wrapPathTool(createEditTool(policy.cwd), policy, "write", maxOutputBytes));
    tools.push(wrapPathTool(createWriteTool(policy.cwd), policy, "write", maxOutputBytes));
  }
  return tools;
}

export function toolNamesForTask(task: SubagentTask): string[] {
  const names = ["read", "grep", "find", "ls", "bash", "submit_subagent_result"];
  if (task.capability.profile !== "read-only") names.push("edit", "write");
  return names;
}
