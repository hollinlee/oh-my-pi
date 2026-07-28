import { lstatSync, unlinkSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { usageIntakePath } from "./intake.ts";
import { UsageStore } from "./store.ts";

const LEDGER_FILENAMES = ["usage.sqlite3", "usage.sqlite3-wal", "usage.sqlite3-shm"] as const;

export type PurgeUsageResult = { removed: string[] };

function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertDirectoryBoundary(path: string, label: string): void {
  const stat = lstatIfPresent(path);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing to purge: ${label} is not a real directory`);
  }
}

/** Removes only files owned by usage accounting, then creates a fresh empty ledger. */
export function purgeUsage(stateDir: string): PurgeUsageResult {
  const boundary = resolve(stateDir);
  assertDirectoryBoundary(boundary, "usage state path");

  const intakeDir = join(boundary, "intake");
  assertDirectoryBoundary(intakeDir, "usage intake path");

  const knownPaths = [
    ...LEDGER_FILENAMES.map((name) => join(boundary, name)),
    usageIntakePath(boundary),
  ];
  const presentPaths = knownPaths.filter((knownPath) => {
    const stat = lstatIfPresent(knownPath);
    if (!stat) return false;
    if (stat.isDirectory()) throw new Error(`Refusing to purge usage-owned file because it is a directory: ${knownPath}`);
    return true;
  });

  for (const knownPath of presentPaths) unlinkSync(knownPath);

  const store = new UsageStore(boundary);
  store.close();
  return { removed: presentPaths };
}
