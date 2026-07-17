import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MINERU_API_BASE = "https://mineru.net";
export const MINERU_KEYCHAIN_SERVICE = "pi-tool-api-key-mineru";
export const MINERU_DISCLOSURE_VERSION = "mineru-cloud-retention-up-to-30-days-v1";

export type MineruAuthorization = {
  cloudUploadAuthorized: true;
  authorizedAt: string;
  service: string;
  retentionDisclosure: string;
};

export type MineruTokenSource = "environment" | "keychain" | "none";

export type MineruStatus = {
  disabled: boolean;
  authorized: boolean;
  configured: boolean;
  ready: boolean;
  tokenSource: MineruTokenSource;
  tokenId?: string;
  configPath: string;
  authorization?: MineruAuthorization;
};

export interface MineruKeychain {
  get(service: string): Promise<string | undefined>;
  set(service: string, token: string): Promise<void>;
  delete(service: string): Promise<void>;
}

export type MineruConfigOptions = {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  keychain?: MineruKeychain;
  now?: () => Date;
  platform?: NodeJS.Platform;
};

function runtimeStateDir(env: NodeJS.ProcessEnv): string {
  return env.PI_MINERU_STATE_DIR || join(homedir(), ".pi", "agent", "mineru");
}

export function mineruConfigPath(options: MineruConfigOptions = {}): string {
  const env = options.env ?? process.env;
  return join(options.stateDir ?? runtimeStateDir(env), "config.json");
}

function account(env: NodeJS.ProcessEnv): string | undefined {
  return env.USER || env.LOGNAME;
}

export class MacOSMineruKeychain implements MineruKeychain {
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;

  constructor(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
    this.env = env;
    this.platform = platform;
  }

  async get(service: string): Promise<string | undefined> {
    if (this.platform !== "darwin") return undefined;
    const user = account(this.env);
    if (!user) return undefined;
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", user, "-s", service, "-w"], {
        env: this.env,
        encoding: "utf8",
      });
      const token = stdout.trim();
      return token || undefined;
    } catch {
      return undefined;
    }
  }

  async set(service: string, token: string): Promise<void> {
    if (this.platform !== "darwin") throw new Error("MinerU Keychain setup is only available on macOS; use MINERU_TOKEN on this platform.");
    const user = account(this.env);
    if (!user) throw new Error("Cannot determine the local account for macOS Keychain.");
    await execFileAsync("security", ["add-generic-password", "-a", user, "-s", service, "-w", token, "-U"], {
      env: this.env,
      encoding: "utf8",
    });
  }

  async delete(service: string): Promise<void> {
    if (this.platform !== "darwin") return;
    const user = account(this.env);
    if (!user) return;
    try {
      await execFileAsync("security", ["delete-generic-password", "-a", user, "-s", service], {
        env: this.env,
        encoding: "utf8",
      });
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? "");
      if (!/could not be found|SecKeychainSearchCopyNext/i.test(stderr)) throw error;
    }
  }
}

function keychainFor(options: MineruConfigOptions, env: NodeJS.ProcessEnv): MineruKeychain {
  return options.keychain ?? new MacOSMineruKeychain(env, options.platform ?? process.platform);
}

function isAuthorization(value: unknown): value is MineruAuthorization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.cloudUploadAuthorized === true
    && typeof item.authorizedAt === "string"
    && item.service === MINERU_API_BASE
    && item.retentionDisclosure === MINERU_DISCLOSURE_VERSION;
}

export async function readMineruAuthorization(options: MineruConfigOptions = {}): Promise<MineruAuthorization | undefined> {
  const path = mineruConfigPath(options);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isAuthorization(parsed) ? parsed : undefined;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    return undefined;
  }
}

export async function writeMineruAuthorization(options: MineruConfigOptions = {}): Promise<MineruAuthorization> {
  const path = mineruConfigPath(options);
  const authorization: MineruAuthorization = {
    cloudUploadAuthorized: true,
    authorizedAt: (options.now ?? (() => new Date()))().toISOString(),
    service: MINERU_API_BASE,
    retentionDisclosure: MINERU_DISCLOSURE_VERSION,
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(authorization, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return authorization;
}

export async function removeMineruAuthorization(options: MineruConfigOptions = {}): Promise<void> {
  await rm(mineruConfigPath(options), { force: true });
}

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 10);
}

export async function resolveMineruToken(options: MineruConfigOptions = {}): Promise<{ token?: string; source: MineruTokenSource; id?: string }> {
  const env = options.env ?? process.env;
  const environmentToken = env.MINERU_TOKEN?.trim();
  if (environmentToken) return { token: environmentToken, source: "environment", id: tokenId(environmentToken) };

  const token = (await keychainFor(options, env).get(MINERU_KEYCHAIN_SERVICE))?.trim();
  if (token) return { token, source: "keychain", id: tokenId(token) };
  return { source: "none" };
}

export async function getMineruStatus(options: MineruConfigOptions = {}): Promise<MineruStatus> {
  const env = options.env ?? process.env;
  const [authorization, resolved] = await Promise.all([
    readMineruAuthorization(options),
    resolveMineruToken(options),
  ]);
  const disabled = env.OH_MY_PI_MINERU_DISABLED === "1";
  const authorized = Boolean(authorization);
  const configured = Boolean(resolved.token);
  return {
    disabled,
    authorized,
    configured,
    ready: !disabled && authorized && configured,
    tokenSource: resolved.source,
    tokenId: resolved.id,
    configPath: mineruConfigPath(options),
    authorization,
  };
}

export async function setupMineruAuthorization(options: MineruConfigOptions = {}): Promise<MineruStatus> {
  const env = options.env ?? process.env;
  const keychain = keychainFor(options, env);
  const environmentToken = env.MINERU_TOKEN?.trim();
  const existingKeychainToken = (await keychain.get(MINERU_KEYCHAIN_SERVICE))?.trim();
  const token = environmentToken || existingKeychainToken;
  if (!token) {
    throw new Error("MinerU token not found. Set MINERU_TOKEN for setup, or install it in macOS Keychain service pi-tool-api-key-mineru.");
  }
  if (environmentToken && (options.platform ?? process.platform) === "darwin") {
    await keychain.set(MINERU_KEYCHAIN_SERVICE, environmentToken);
  }
  await writeMineruAuthorization(options);
  return getMineruStatus(options);
}

export async function revokeMineruAuthorization(deleteKeychainToken: boolean, options: MineruConfigOptions = {}): Promise<MineruStatus> {
  const env = options.env ?? process.env;
  await removeMineruAuthorization(options);
  if (deleteKeychainToken) await keychainFor(options, env).delete(MINERU_KEYCHAIN_SERVICE);
  return getMineruStatus(options);
}
