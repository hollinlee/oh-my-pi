import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeConfiguredRemoteExperimentCommand } from "../remote-devices/index.ts";
import { commandFingerprint, type RemoteExecRequest, type RemoteExecResponse } from "./remote-runner.ts";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "command";
}

export function createConfiguredRemoteExperimentExecutor(logRoot = path.join(os.homedir(), ".pi", "agent", "model-tasks", "remote-logs")) {
  return async (request: RemoteExecRequest): Promise<RemoteExecResponse> => {
    await mkdir(logRoot, { recursive: true, mode: 0o700 });
    await chmod(logRoot, 0o700);
    const result = await executeConfiguredRemoteExperimentCommand({
      deviceId: request.deviceId,
      user: request.user,
      workdir: request.workdir,
      command: request.command,
      timeoutSeconds: request.timeoutSeconds,
      allowDangerous: request.allowDangerous,
      resourceLimits: request.resourceLimits,
      signal: request.signal,
    });
    const stem = `${safeSegment(request.deviceId)}-${commandFingerprint(request.command)}-${randomUUID()}`;
    const stdoutPath = path.join(logRoot, `${stem}.stdout.log`);
    const stderrPath = path.join(logRoot, `${stem}.stderr.log`);
    await writeFile(stdoutPath, result.stdout, { encoding: "utf8", mode: 0o600 });
    await writeFile(stderrPath, result.stderr, { encoding: "utf8", mode: 0o600 });
    return { ...result, stdoutPath, stderrPath };
  };
}
