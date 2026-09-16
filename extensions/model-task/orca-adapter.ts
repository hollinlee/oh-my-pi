import type { TaskCheckpoint } from "./schemas.ts";
import { snapshotFromCheckpoint, type TaskProgressSnapshot } from "./observability.ts";

export type OrcaTaskSession = {
  sessionId: string;
  taskId: string;
  protocolVersion: number;
  scope: TaskCheckpoint["task"]["scope"];
};

export type OrcaTaskUpdate = {
  session: OrcaTaskSession;
  phase: string;
  status: TaskCheckpoint["status"];
  model?: TaskProgressSnapshot["model"];
  modelChanged: boolean;
  events: TaskProgressSnapshot["recentEvents"];
  final?: TaskProgressSnapshot["final"];
};

export type OrcaTaskSink = (update: OrcaTaskUpdate) => void | Promise<void>;

export function isOrcaTaskAdapterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OH_MY_PI_MODEL_TASK_ORCA_ENABLED === "1";
}

export class OrcaTaskAdapter {
  private readonly sink: OrcaTaskSink;
  private readonly sessions = new Map<string, OrcaTaskSession>();
  private readonly models = new Map<string, string>();

  constructor(sink: OrcaTaskSink) {
    this.sink = sink;
  }

  async observe(checkpoint: TaskCheckpoint): Promise<void> {
    const snapshot = snapshotFromCheckpoint(checkpoint);
    const session = this.sessions.get(checkpoint.task.id) ?? {
      sessionId: `model-task:${checkpoint.task.id}`,
      taskId: checkpoint.task.id,
      protocolVersion: checkpoint.schemaVersion,
      scope: checkpoint.task.scope,
    };
    this.sessions.set(checkpoint.task.id, session);
    const modelKey = snapshot.model ? `${snapshot.model.provider}/${snapshot.model.name}/${snapshot.model.role}` : "";
    const previous = this.models.get(checkpoint.task.id);
    this.models.set(checkpoint.task.id, modelKey);
    await this.sink({
      session,
      phase: snapshot.phase,
      status: snapshot.status,
      ...(snapshot.model ? { model: snapshot.model } : {}),
      modelChanged: previous !== undefined && previous !== modelKey,
      events: snapshot.recentEvents,
      ...(snapshot.final ? { final: snapshot.final } : {}),
    });
  }
}

export function createBestEffortOrcaObserver(adapter: OrcaTaskAdapter | undefined): (checkpoint: TaskCheckpoint) => void {
  return (checkpoint) => {
    if (!adapter) return;
    void adapter.observe(checkpoint).catch(() => {
      // Orca is optional. Core checkpoint persistence remains authoritative.
    });
  };
}
