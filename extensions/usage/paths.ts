import { homedir } from "node:os";
import { join } from "node:path";

export function usageStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OH_MY_PI_USAGE_STATE_DIR || join(homedir(), ".pi", "agent", "usage");
}

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_SESSIONS_DIR || join(homedir(), ".pi", "agent", "sessions");
}
