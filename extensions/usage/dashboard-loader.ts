import { Worker } from "node:worker_threads";
import type { UsageDashboardSnapshot, UsageRange } from "./dashboard-data.ts";

export type LoadUsageDashboardOptions = {
  stateDir: string;
  sessionsDir: string;
  intakePath: string;
  range: UsageRange;
  now?: Date;
  sync?: boolean;
  signal?: AbortSignal;
};

export type LoadUsageDashboardResult = {
  snapshot: UsageDashboardSnapshot;
  intakeErrors: number;
};

type WorkerLike = {
  once(event: "message", listener: (value: unknown) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  removeAllListeners(): unknown;
  terminate(): Promise<number>;
};

type WorkerFactory = (input: Record<string, unknown>) => WorkerLike;

function abortError(): Error {
  return new DOMException("Usage dashboard loading was cancelled", "AbortError");
}

function defaultWorkerFactory(input: Record<string, unknown>): WorkerLike {
  return new Worker(new URL("./dashboard-worker.ts", import.meta.url), { workerData: input });
}

export function loadUsageDashboard(
  options: LoadUsageDashboardOptions,
  createWorker: WorkerFactory = defaultWorkerFactory,
): Promise<LoadUsageDashboardResult> {
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const worker = createWorker({
      stateDir: options.stateDir,
      sessionsDir: options.sessionsDir,
      intakePath: options.intakePath,
      range: options.range,
      now: options.now?.toISOString(),
      sync: options.sync ?? true,
    });
    let settled = false;

    const finish = (outcome: { value: LoadUsageDashboardResult } | { error: unknown }): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
      if ("value" in outcome) resolve(outcome.value);
      else reject(outcome.error);
    };
    const onAbort = (): void => {
      void worker.terminate().catch(() => undefined);
      finish({ error: abortError() });
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (value) => {
      const result = value as Partial<LoadUsageDashboardResult>;
      if (!result.snapshot || typeof result.intakeErrors !== "number") {
        finish({ error: new Error("Usage dashboard worker returned an invalid response") });
        return;
      }
      finish({ value: result as LoadUsageDashboardResult });
    });
    worker.once("error", (error) => finish({ error }));
    worker.once("exit", (code) => {
      if (code !== 0) finish({ error: new Error(`Usage dashboard worker exited with code ${code}`) });
      else finish({ error: new Error("Usage dashboard worker exited without a response") });
    });
    if (options.signal?.aborted) onAbort();
  });
}
