import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Value } from "typebox/value";
import {
  REMOTE_EXPERIMENT_SCHEMA_VERSION,
  RemoteExperimentCheckpointSchema,
  RemoteExperimentSchema,
  type RemoteCommand,
  type RemoteCommandRecord,
  type RemoteExperiment,
  type RemoteExperimentCheckpoint,
  type RemoteExperimentResult,
} from "./remote-schemas.ts";

export type RemoteExecRequest = {
  deviceId: string;
  user: string;
  workdir: string;
  command: string;
  timeoutSeconds: number;
  resourceLimits: RemoteExperiment["resourceLimits"];
  allowDangerous: boolean;
  signal?: AbortSignal;
};

export type RemoteExecResponse = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  cancelled?: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  resourceUsage?: Record<string, string>;
};

export type RemoteExecutor = (request: RemoteExecRequest) => Promise<RemoteExecResponse>;
export type RemoteApproval = (input: { deviceId: string; user: string; workdir: string; command: string }) => Promise<boolean>;

const DEFAULT_COMMAND_TIMEOUT = 60;
const DEFAULT_TASK_TIMEOUT = 30 * 60;
const DEFAULT_RETRIES = 3;
const HIGH_RISK_COMMAND = /\b(?:reboot|shutdown|poweroff|halt|rm\s+-[^\n]*[rf]|dd\b|mkfs|parted|fdisk|wipefs|systemctl\s+(?:stop|disable|mask|restart)|chmod\s+-R|chown\s+-R|iptables|ufw|nft)\b|\/etc\/ssh\/sshd_config|\b(?:drop\s+database|drop\s+table|truncate\s+table)\b/i;
const runLocks = new Map<string, Promise<RemoteExperimentResult>>();

function assertSchema<T>(schema: any, value: unknown, label: string): asserts value is T {
  if (!Value.Check(schema, value)) throw new Error(`Invalid ${label}`);
}

function serializeRun(key: string, operation: () => Promise<RemoteExperimentResult>): Promise<RemoteExperimentResult> {
  const active = runLocks.get(key);
  if (active) return active;
  const current = operation().finally(() => {
    if (runLocks.get(key) === current) runLocks.delete(key);
  });
  runLocks.set(key, current);
  return current;
}

function serializeStore<T>(locks: Map<string, Promise<void>>, key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, current);
  return previous.then(operation).finally(() => {
    release();
    if (locks.get(key) === current) locks.delete(key);
  });
}

function validateExperiment(experiment: RemoteExperiment): void {
  assertSchema<RemoteExperiment>(RemoteExperimentSchema, experiment, "remote experiment");
  if (experiment.maxConcurrentDevices !== undefined && experiment.maxConcurrentDevices !== 1) {
    throw new Error("Remote experiments support one explicitly selected device by default");
  }
  if (Object.keys(experiment.resourceLimits).length === 0) {
    throw new Error("Remote experiment resourceLimits must declare at least one limit");
  }
  if (!experiment.workdir.startsWith("/") && !experiment.workdir.startsWith("~/")) {
    throw new Error("Remote experiment workdir must be an explicit absolute or home-relative path");
  }
}

function commandAllowed(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try { return new RegExp(pattern).test(command); } catch { return false; }
  });
}

function commandSummary(command: string): string {
  return command.length > 160 ? `${command.slice(0, 159)}…` : command;
}

function recordFor(experiment: RemoteExperiment, command: RemoteCommand, response: RemoteExecResponse, attempts: number, startedAt: number, outcome: RemoteCommandRecord["outcome"]): RemoteCommandRecord {
  return {
    commandId: command.id,
    deviceId: experiment.deviceId,
    user: experiment.user,
    workdir: experiment.workdir,
    commandSummary: commandSummary(command.command),
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + response.durationMs).toISOString(),
    durationMs: response.durationMs,
    exitCode: response.exitCode,
    ...(response.stdoutPath ? { stdoutPath: response.stdoutPath } : {}),
    ...(response.stderrPath ? { stderrPath: response.stderrPath } : {}),
    ...(response.resourceUsage ? { resourceUsage: response.resourceUsage } : {}),
    outcome,
    attempts,
  };
}

function escalation(reason: string, summary: string, records: RemoteCommandRecord[]) {
  return {
    reason,
    summary,
    attempted: records.map((record) => record.commandSummary),
    evidence: records.map((record) => ({ claim: `${record.commandId}: ${record.outcome}`, source: `${record.deviceId}/${record.workdir}` })),
    question: "请确认是否调整任务授权、资源或清理策略后继续。",
  };
}

export class RemoteExperimentStore {
  readonly root: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.root = root;
  }

  pathFor(id: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id)) throw new Error(`Invalid remote experiment id: ${id}`);
    return path.join(this.root, `${id}.json`);
  }

  async load(id: string): Promise<RemoteExperimentCheckpoint | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) { throw new Error(`Invalid remote experiment checkpoint JSON: ${(error as Error).message}`); }
    assertSchema<RemoteExperimentCheckpoint>(RemoteExperimentCheckpointSchema, parsed, "remote experiment checkpoint");
    if (parsed.experiment.id !== id) throw new Error(`Remote experiment checkpoint id mismatch: expected ${id}, got ${parsed.experiment.id}`);
    return parsed;
  }

  async save(checkpoint: RemoteExperimentCheckpoint, expectedRevision?: number): Promise<void> {
    assertSchema<RemoteExperimentCheckpoint>(RemoteExperimentCheckpointSchema, checkpoint, "remote experiment checkpoint");
    const target = this.pathFor(checkpoint.experiment.id);
    await serializeStore(this.locks, target, async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await chmod(this.root, 0o700);
      if (expectedRevision !== undefined) {
        const existing = await this.load(checkpoint.experiment.id);
        const actual = existing?.revision ?? -1;
        if (actual !== expectedRevision) throw new Error(`Stale remote experiment checkpoint: expected ${expectedRevision}, got ${actual}`);
      }
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
      let renamed = false;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, target);
        renamed = true;
        await chmod(target, 0o600);
      } finally {
        if (!renamed) await rm(temporary, { force: true });
      }
    });
  }
}

export class RemoteExperimentRunner {
  private readonly execute: RemoteExecutor;
  private readonly approveHighRisk: RemoteApproval;
  private readonly checkpointStore?: RemoteExperimentStore;

  constructor(execute: RemoteExecutor, approveHighRisk: RemoteApproval = async () => false, checkpointStore?: RemoteExperimentStore) {
    this.execute = execute;
    this.approveHighRisk = approveHighRisk;
    this.checkpointStore = checkpointStore;
  }

  run(experiment: RemoteExperiment, signal?: AbortSignal): Promise<RemoteExperimentResult> {
    const key = `${this.checkpointStore?.root ?? "memory"}:${experiment.id}`;
    return serializeRun(key, () => this.runExclusive(experiment, signal));
  }

  private async runExclusive(experiment: RemoteExperiment, signal?: AbortSignal): Promise<RemoteExperimentResult> {
    validateExperiment(experiment);
    let checkpoint = await this.checkpointStore?.load(experiment.id);
    if (checkpoint && !isDeepStrictEqual(checkpoint.experiment, experiment)) {
      throw new Error(`Remote experiment definition mismatch for existing id: ${experiment.id}`);
    }
    if (checkpoint?.status === "succeeded" || checkpoint?.status === "failed" || checkpoint?.status === "cancelled") {
      return this.resultFrom(checkpoint);
    }
    if (checkpoint?.status === "needs_review" || checkpoint?.status === "blocked") return this.resultFrom(checkpoint);
    const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
    checkpoint ??= {
      schemaVersion: REMOTE_EXPERIMENT_SCHEMA_VERSION,
      revision: 0,
      experiment,
      status: "running",
      startedAt,
      updatedAt: new Date().toISOString(),
      nextCommandIndex: 0,
      records: [],
    };
    if (!this.checkpointStore) {
      // The in-memory path still uses the same state object and safety rules.
    } else if (!await this.checkpointStore.load(experiment.id)) {
      await this.checkpointStore.save(checkpoint);
    }
    if (checkpoint.activeCommand && !checkpoint.activeCommand.idempotent) {
      return this.finish(checkpoint, "needs_review", escalation("side_effect_uncertain", `Non-idempotent command was interrupted: ${checkpoint.activeCommand.id}`, checkpoint.records));
    }

    const taskDeadline = Date.parse(startedAt) + (experiment.taskTimeoutSeconds ?? DEFAULT_TASK_TIMEOUT) * 1000;
    const maxRetries = experiment.maxRetries ?? DEFAULT_RETRIES;
    const commandTimeout = experiment.commandTimeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT;
    for (let index = checkpoint.nextCommandIndex; index < experiment.commands.length; index += 1) {
      const command = experiment.commands[index];
      if (!commandAllowed(command.command, experiment.allowedCommandPatterns)) {
        return this.finish(checkpoint, "blocked", escalation("policy", `Command is outside the declared allowlist: ${command.id}`, checkpoint.records));
      }
      let approved = false;
      if (HIGH_RISK_COMMAND.test(command.command)) {
        approved = await this.approveHighRisk({ deviceId: experiment.deviceId, user: experiment.user, workdir: experiment.workdir, command: command.command });
        if (!approved) return this.finish(checkpoint, "blocked", escalation("high_risk_approval", `High-risk command requires approval: ${command.id}`, checkpoint.records));
      }
      if (Date.now() >= taskDeadline) return this.finish(checkpoint, "blocked", escalation("timeout", "Remote experiment task timeout exceeded before command", checkpoint.records));

      checkpoint = await this.updateCheckpoint(checkpoint, {
        status: "running",
        nextCommandIndex: index,
        activeCommand: { id: command.id, idempotent: command.idempotent },
      });
      let attempts = 0;
      let completed = false;
      while (attempts <= maxRetries) {
        attempts += 1;
        const started = Date.now();
        let response: RemoteExecResponse;
        try {
          response = await this.execute({
            deviceId: experiment.deviceId,
            user: experiment.user,
            workdir: experiment.workdir,
            command: command.command,
            timeoutSeconds: Math.min(commandTimeout, Math.max(1, Math.ceil((taskDeadline - Date.now()) / 1000))),
            resourceLimits: experiment.resourceLimits,
            allowDangerous: approved,
            signal,
          });
        } catch (error) {
          return this.finish(checkpoint, "needs_review", escalation("side_effect_uncertain", `Remote executor failed for ${command.id}: ${(error as Error).message}`, checkpoint.records));
        }
        const outcome: RemoteCommandRecord["outcome"] = response.cancelled || signal?.aborted
          ? "cancelled"
          : response.timedOut
            ? "timed_out"
            : response.exitCode === 0
              ? "succeeded"
              : "failed";
        const record = recordFor(experiment, command, response, attempts, started, outcome);
        const records = [...checkpoint.records, record];
        if (outcome === "cancelled") return this.finish(checkpoint, "cancelled", undefined, records, index + 1);
        if (outcome === "succeeded") {
          checkpoint = await this.updateCheckpoint(checkpoint, { status: "running", nextCommandIndex: index + 1, activeCommand: undefined, records });
          completed = true;
          break;
        }
        if (!command.idempotent) {
          return this.finish({ ...checkpoint, records }, response.timedOut ? "needs_review" : "failed", response.timedOut ? escalation("side_effect_uncertain", `Non-idempotent command timed out: ${command.id}`, records) : undefined, records, index + 1);
        }
        checkpoint = await this.updateCheckpoint(checkpoint, { status: "running", nextCommandIndex: index, activeCommand: { id: command.id, idempotent: true }, records });
        if (attempts > maxRetries) return this.finish(checkpoint, "failed", undefined, records, index + 1);
      }
      if (!completed) return this.finish(checkpoint, "failed");
    }
    return this.finish(checkpoint, "succeeded", undefined, checkpoint.records, experiment.commands.length);
  }

  private resultFrom(checkpoint: RemoteExperimentCheckpoint): RemoteExperimentResult {
    return {
      status: checkpoint.status,
      records: checkpoint.records,
      cleanup: checkpoint.experiment.cleanup,
      ...(checkpoint.escalation ? { escalation: checkpoint.escalation } : {}),
    };
  }

  private async updateCheckpoint(checkpoint: RemoteExperimentCheckpoint, patch: Partial<RemoteExperimentCheckpoint>): Promise<RemoteExperimentCheckpoint> {
    const next = { ...checkpoint, ...patch, revision: checkpoint.revision + 1, updatedAt: new Date().toISOString() };
    if (this.checkpointStore) await this.checkpointStore.save(next, checkpoint.revision);
    return next;
  }

  private async finish(checkpoint: RemoteExperimentCheckpoint, status: RemoteExperimentCheckpoint["status"], detail?: ReturnType<typeof escalation>, records = checkpoint.records, nextCommandIndex = checkpoint.nextCommandIndex): Promise<RemoteExperimentResult> {
    const next = await this.updateCheckpoint({ ...checkpoint, records }, { status, nextCommandIndex, activeCommand: undefined, escalation: detail });
    return this.resultFrom(next);
  }
}

export function commandFingerprint(command: string): string {
  return createHash("sha256").update(command).digest("hex").slice(0, 16);
}
