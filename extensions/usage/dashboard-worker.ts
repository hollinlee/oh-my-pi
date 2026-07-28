import { parentPort, workerData } from "node:worker_threads";
import { queryUsageDashboard, type UsageRange } from "./dashboard-data.ts";
import { importUsageIntake } from "./intake.ts";
import { scanSessions } from "./scanner.ts";
import { UsageStore } from "./store.ts";

type WorkerInput = {
  stateDir: string;
  sessionsDir: string;
  intakePath: string;
  range: UsageRange;
  now?: string;
  sync: boolean;
};

const input = workerData as WorkerInput;
const store = new UsageStore(input.stateDir);
try {
  let intakeErrors = 0;
  if (input.sync) {
    scanSessions(store, input.sessionsDir);
    intakeErrors = importUsageIntake(store, input.intakePath).errors.length;
  }
  const snapshot = queryUsageDashboard(store, input.range, input.now ? new Date(input.now) : new Date());
  parentPort?.postMessage({ snapshot, intakeErrors });
} finally {
  store.close();
}
