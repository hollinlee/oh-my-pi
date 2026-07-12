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

export function createPathPolicy(task: SubagentTask): PathPolicy {
  const cwd = canonicalTarget(task.scope.cwd || process.cwd());
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

function wrapPathTool(tool: ToolDefinition, policy: PathPolicy, operation: "read" | "write"): ToolDefinition {
  return {
    ...tool,
    async execute(id: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      if (typeof params.path !== "string") throw new CapabilityViolation("tool path is required");
      policy.assertPath(params.path, operation);
      return tool.execute(id, params, signal, onUpdate, ctx);
    },
  } as ToolDefinition;
}

export function createScopedFileTools(task: SubagentTask): ToolDefinition[] {
  const policy = createPathPolicy(task);
  const tools: ToolDefinition[] = [
    wrapPathTool(createReadTool(policy.cwd), policy, "read"),
    wrapPathTool(createGrepTool(policy.cwd), policy, "read"),
    wrapPathTool(createFindTool(policy.cwd), policy, "read"),
    wrapPathTool(createLsTool(policy.cwd), policy, "read"),
  ];
  if (task.capability.profile !== "read-only") {
    tools.push(wrapPathTool(createEditTool(policy.cwd), policy, "write"));
    tools.push(wrapPathTool(createWriteTool(policy.cwd), policy, "write"));
  }
  return tools;
}

export function toolNamesForTask(task: SubagentTask): string[] {
  const names = ["read", "grep", "find", "ls", "submit_subagent_result"];
  if (task.capability.profile !== "read-only") names.push("edit", "write", "bash");
  return names;
}
