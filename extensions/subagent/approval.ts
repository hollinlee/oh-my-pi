import type { SubagentTask } from "./schemas.ts";

export function requiresInteractiveApproval(task: SubagentTask): boolean {
  return task.capability.profile === "elevated";
}
