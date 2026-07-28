import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { usageIntakePath } from "./intake.ts";
import { usageStateDir } from "./paths.ts";
import { USAGE_SCHEMA_VERSION } from "./store.ts";

export type UsageHealthCheck = {
  severity: "pass" | "info" | "fail";
  label: string;
  detail?: string;
};

function lstatIfPresent(target: string) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function mode(target: string): string {
  return (fs.lstatSync(target).mode & 0o777).toString(8).padStart(3, "0");
}

function writable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function detail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

export function checkUsageHealth(): UsageHealthCheck[] {
  const stateDir = usageStateDir();
  const dbPath = path.join(stateDir, "usage.sqlite3");
  const intakePath = usageIntakePath(stateDir);
  const intakeDir = path.dirname(intakePath);
  const stateStat = lstatIfPresent(stateDir);
  if (!stateStat) {
    return [
      { severity: "info", label: "usage ledger not initialized", detail: stateDir },
      { severity: "info", label: "usage permissions pending initialization" },
      { severity: "info", label: "usage intake writability pending initialization" },
    ];
  }
  if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
    return [{ severity: "fail", label: "usage state path is not a real directory", detail: stateDir }];
  }

  const checks: UsageHealthCheck[] = [];
  const dbStat = lstatIfPresent(dbPath);
  const intakeDirStat = lstatIfPresent(intakeDir);
  const intakeStat = lstatIfPresent(intakePath);
  const unsafePaths: string[] = [];
  if (dbStat && (!dbStat.isFile() || dbStat.isSymbolicLink())) unsafePaths.push("database is not a real file");
  if (intakeDirStat && (!intakeDirStat.isDirectory() || intakeDirStat.isSymbolicLink())) unsafePaths.push("intake path is not a real directory");
  if (intakeStat && (!intakeStat.isFile() || intakeStat.isSymbolicLink())) unsafePaths.push("intake journal is not a real file");
  if (unsafePaths.length > 0) {
    checks.push({ severity: "fail", label: "usage state contains unsafe paths", detail: unsafePaths.join(", ") });
  }

  if (!dbStat) {
    checks.push({ severity: "info", label: "usage ledger not initialized", detail: dbPath });
  } else if (dbStat.isFile() && !dbStat.isSymbolicLink()) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
        const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
        checks.push(version === USAGE_SCHEMA_VERSION && tables.has("events") && tables.has("sources")
          ? { severity: "pass", label: "usage ledger schema valid", detail: `version ${version}` }
          : { severity: "fail", label: "usage ledger schema invalid", detail: `version ${version}` });
      } finally {
        db.close();
      }
    } catch (error) {
      checks.push({ severity: "fail", label: "usage ledger schema unreadable", detail: detail(error) });
    }
  }

  const permissionProblems: string[] = [];
  if (mode(stateDir) !== "700") permissionProblems.push(`state ${mode(stateDir)} (expected 700)`);
  if (dbStat?.isFile() && !dbStat.isSymbolicLink() && mode(dbPath) !== "600") permissionProblems.push(`DB ${mode(dbPath)} (expected 600)`);
  if (intakeDirStat?.isDirectory() && !intakeDirStat.isSymbolicLink() && mode(intakeDir) !== "700") permissionProblems.push(`intake dir ${mode(intakeDir)} (expected 700)`);
  if (intakeStat?.isFile() && !intakeStat.isSymbolicLink() && mode(intakePath) !== "600") permissionProblems.push(`intake ${mode(intakePath)} (expected 600)`);
  checks.push(permissionProblems.length === 0
    ? { severity: "pass", label: "usage state and files have private permissions" }
    : { severity: "fail", label: "usage permissions are too broad", detail: permissionProblems.join(", ") });

  const unwritable: string[] = [];
  if (!writable(stateDir)) unwritable.push("state directory");
  if (dbStat?.isFile() && !dbStat.isSymbolicLink() && !writable(dbPath)) unwritable.push("database");
  if (intakeDirStat?.isDirectory() && !intakeDirStat.isSymbolicLink() && !writable(intakeDir)) unwritable.push("intake directory");
  if (intakeStat?.isFile() && !intakeStat.isSymbolicLink() && !writable(intakePath)) unwritable.push("intake journal");
  checks.push(unwritable.length === 0
    ? { severity: "pass", label: "usage ledger and intake are writable" }
    : { severity: "fail", label: "usage ledger or intake is not writable", detail: unwritable.join(", ") });
  return checks;
}
