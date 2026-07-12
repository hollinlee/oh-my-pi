import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STATE_ROOT = path.join(os.homedir(), ".pi", "agent", "subagents");
const WORKTREE_ROOT = path.join(STATE_ROOT, "worktrees");
const ARTIFACT_ROOT = path.join(STATE_ROOT, "artifacts");

export type IsolationHandoff = {
  mode: "git-worktree" | "directory-copy";
  state: "running" | "handoff-ready" | "cleaned" | "failed";
  sourcePath: string;
  workspacePath: string;
  branch?: string;
  gitStatus?: string;
  changedPaths: string[];
  untrackedPaths: string[];
  binaryPaths: string[];
  patchArtifact?: string;
  retained: boolean;
  cleanupCommand?: string;
  error?: string;
};

export type PreparedIsolation = {
  cwd: string;
  handoff: IsolationHandoff;
  finalize(): Promise<IsolationHandoff>;
};

function safeSlug(input: string): string {
  const value = input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return value || "task";
}

async function runGit(cwd: string, args: string[], allowExitOne = false): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return result.stdout;
  } catch (error: any) {
    if (allowExitOne && error?.code === 1) return error.stdout ?? "";
    throw new Error((error?.stderr || error?.message || String(error)).trim());
  }
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  try { return (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim(); } catch { return undefined; }
}

function parseStatus(status: string): { changed: string[]; untracked: string[] } {
  const changed: string[] = [];
  const untracked: string[] = [];
  for (const line of status.split(/\r?\n/).filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3).replace(/^.* -> /, "");
    changed.push(file);
    if (code === "??") untracked.push(file);
  }
  return { changed, untracked };
}

async function createPatch(workspace: string, taskId: string, untracked: string[]): Promise<string | undefined> {
  const chunks = [await runGit(workspace, ["diff", "--binary", "HEAD"] )];
  for (const file of untracked) {
    const absolute = path.join(workspace, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    chunks.push(await runGit(workspace, ["diff", "--binary", "--no-index", "/dev/null", absolute], true));
  }
  const patch = chunks.filter(Boolean).join("\n");
  if (!patch.trim()) return undefined;
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true, mode: 0o700 });
  const artifact = path.join(ARTIFACT_ROOT, `${safeSlug(taskId)}-${Date.now()}.patch`);
  fs.writeFileSync(artifact, patch, { encoding: "utf8", mode: 0o600 });
  return artifact;
}

async function binaryPaths(workspace: string): Promise<string[]> {
  const output = await runGit(workspace, ["diff", "--numstat", "HEAD"]);
  return output.split(/\r?\n/).filter((line) => line.startsWith("-\t-\t")).map((line) => line.split("\t").slice(2).join("\t"));
}

async function prepareGitIsolation(sourceCwd: string, root: string, taskId: string): Promise<PreparedIsolation> {
  const sourceStatus = await runGit(root, ["status", "--porcelain"]);
  if (sourceStatus.trim()) throw new Error("workspace-write requires a clean source worktree so child context can be reproduced safely");
  fs.mkdirSync(WORKTREE_ROOT, { recursive: true, mode: 0o700 });
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const branch = `subagent/${safeSlug(taskId)}-${suffix}`;
  const workspaceRoot = path.join(WORKTREE_ROOT, `${safeSlug(taskId)}-${suffix}`);
  await runGit(root, ["worktree", "add", "-b", branch, workspaceRoot, "HEAD"]);
  const relativeCwd = path.relative(root, sourceCwd);
  const cwd = path.join(workspaceRoot, relativeCwd);
  const handoff: IsolationHandoff = {
    mode: "git-worktree",
    state: "running",
    sourcePath: sourceCwd,
    workspacePath: workspaceRoot,
    branch,
    changedPaths: [],
    untrackedPaths: [],
    binaryPaths: [],
    retained: true,
  };
  return {
    cwd,
    handoff,
    async finalize() {
      try {
        const status = await runGit(workspaceRoot, ["status", "--short"]);
        const parsed = parseStatus(status);
        handoff.gitStatus = status.trim();
        handoff.changedPaths = parsed.changed;
        handoff.untrackedPaths = parsed.untracked;
        handoff.binaryPaths = await binaryPaths(workspaceRoot);
        handoff.patchArtifact = await createPatch(workspaceRoot, taskId, parsed.untracked);
        if (parsed.changed.length === 0) {
          await runGit(root, ["worktree", "remove", workspaceRoot]);
          await runGit(root, ["branch", "-D", branch]);
          handoff.state = "cleaned";
          handoff.retained = false;
        } else {
          handoff.state = "handoff-ready";
          handoff.cleanupCommand = `git -C ${JSON.stringify(root)} worktree remove ${JSON.stringify(workspaceRoot)} && git -C ${JSON.stringify(root)} branch -D ${JSON.stringify(branch)}`;
        }
      } catch (error) {
        handoff.state = "failed";
        handoff.error = error instanceof Error ? error.message : String(error);
      }
      return handoff;
    },
  };
}

function snapshotFiles(root: string): Map<string, string> {
  const values = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) values.set(path.relative(root, absolute), crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"));
    }
  };
  visit(root);
  return values;
}

async function prepareCopyIsolation(sourceCwd: string, taskId: string): Promise<PreparedIsolation> {
  fs.mkdirSync(WORKTREE_ROOT, { recursive: true, mode: 0o700 });
  const workspace = path.join(WORKTREE_ROOT, `${safeSlug(taskId)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
  fs.cpSync(sourceCwd, workspace, { recursive: true, dereference: false, filter: (source) => path.basename(source) !== "node_modules" });
  const before = snapshotFiles(workspace);
  const handoff: IsolationHandoff = {
    mode: "directory-copy",
    state: "running",
    sourcePath: sourceCwd,
    workspacePath: workspace,
    changedPaths: [],
    untrackedPaths: [],
    binaryPaths: [],
    retained: true,
  };
  return {
    cwd: workspace,
    handoff,
    async finalize() {
      try {
        const after = snapshotFiles(workspace);
        handoff.changedPaths = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file));
        handoff.untrackedPaths = [...after.keys()].filter((file) => !before.has(file));
        if (handoff.changedPaths.length === 0) {
          fs.rmSync(workspace, { recursive: true, force: true });
          handoff.state = "cleaned";
          handoff.retained = false;
        } else {
          handoff.state = "handoff-ready";
          handoff.cleanupCommand = `rm -rf -- ${JSON.stringify(workspace)}`;
        }
      } catch (error) {
        handoff.state = "failed";
        handoff.error = error instanceof Error ? error.message : String(error);
      }
      return handoff;
    },
  };
}

export async function prepareIsolation(sourceCwd: string, taskId: string): Promise<PreparedIsolation> {
  const source = fs.realpathSync.native(sourceCwd);
  const root = await gitRoot(source);
  return root ? prepareGitIsolation(source, root, taskId) : prepareCopyIsolation(source, taskId);
}
