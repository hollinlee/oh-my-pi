import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Value } from "typebox/value";
import { TaskCheckpointSchema, type TaskCheckpoint } from "./schemas.ts";

function assertCheckpoint(value: unknown): asserts value is TaskCheckpoint {
  if (!Value.Check(TaskCheckpointSchema, value)) {
    const errors = [...Value.Errors(TaskCheckpointSchema, value)]
      .slice(0, 5)
      .map((error) => `${error.path || "/"}: ${error.message}`)
      .join("; ");
    throw new Error(`Invalid model task checkpoint: ${errors}`);
  }
}

const taskLocks = new Map<string, Promise<void>>();

async function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = taskLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  taskLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (taskLocks.get(key) === current) taskLocks.delete(key);
  }
}

export class TaskCheckpointStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  pathFor(taskId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(taskId)) {
      throw new Error(`Invalid model task id: ${taskId}`);
    }
    return path.join(this.root, `${taskId}.json`);
  }

  async load(taskId: string): Promise<TaskCheckpoint | undefined> {
    const file = this.pathFor(taskId);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in model task checkpoint ${taskId}: ${(error as Error).message}`);
    }
    assertCheckpoint(parsed);
    if (parsed.task.id !== taskId) {
      throw new Error(`Model task checkpoint id mismatch: expected ${taskId}, got ${parsed.task.id}`);
    }
    return parsed;
  }

  async save(checkpoint: TaskCheckpoint, expectedRevision?: number): Promise<void> {
    assertCheckpoint(checkpoint);
    const target = this.pathFor(checkpoint.task.id);
    await serialize(target, async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await chmod(this.root, 0o700);
      if (expectedRevision !== undefined) {
        const existing = await this.load(checkpoint.task.id);
        const actualRevision = existing?.revision ?? -1;
        if (actualRevision !== expectedRevision) {
          throw new Error(`Stale model task checkpoint ${checkpoint.task.id}: expected revision ${expectedRevision}, got ${actualRevision}`);
        }
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
