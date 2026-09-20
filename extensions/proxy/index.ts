import { lookup } from "node:dns/promises";
import net from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { requestPermission } from "../permissions/index.ts";

const DEFAULT_PROXY_PORT = 7897;
const DEFAULT_TARGET = "github.com";
const proxyPort = () => Number.parseInt(process.env.PROXY_PORT ?? String(DEFAULT_PROXY_PORT), 10);
const proxyHost = () => process.env.PROXY_HOST ?? "127.0.0.1";

export interface ProxyStatus {
  enabled: boolean;
  httpProxy?: string;
  host: string;
  port: number;
}

export function readProxyStatus(env: NodeJS.ProcessEnv = process.env): ProxyStatus {
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY;
  return { enabled: Boolean(httpProxy), httpProxy, host: env.PROXY_HOST ?? "127.0.0.1", port: Number.parseInt(env.PROXY_PORT ?? String(DEFAULT_PROXY_PORT), 10) };
}

function setProxyEnvironment(enabled: boolean): ProxyStatus {
  if (enabled) {
    const host = proxyHost();
    const port = proxyPort();
    const http = `http://${host}:${port}`;
    process.env.http_proxy = http;
    process.env.https_proxy = http;
    process.env.all_proxy = `socks5://${host}:${port}`;
    process.env.HTTP_PROXY = http;
    process.env.HTTPS_PROXY = http;
    process.env.ALL_PROXY = process.env.all_proxy;
    process.env.no_proxy = "localhost,127.0.0.1,::1,*.local,192.168.0.0/16,10.0.0.0/8";
    process.env.NO_PROXY = process.env.no_proxy;
  } else {
    for (const key of ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "no_proxy", "NO_PROXY"]) delete process.env[key];
  }
  return readProxyStatus();
}

function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, detail: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve({ ok: true, detail: "TCP connection succeeded" });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) });
    });
  });
}

export async function retryIdempotent<T>(operation: () => Promise<T>, idempotent: boolean, retries = 1): Promise<T> {
  if (!idempotent) return operation();
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= Math.max(0, retries)) throw error;
      attempt += 1;
    }
  }
}

export async function diagnoseProxy(target = DEFAULT_TARGET): Promise<Record<string, unknown>> {
  const status = readProxyStatus();
  let dns: { ok: boolean; addresses?: string[]; detail?: string };
  try {
    const addresses = await lookup(target, { all: true });
    dns = { ok: true, addresses: addresses.map((entry) => entry.address).slice(0, 4) };
  } catch (error) {
    dns = { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const proxy = await tcpProbe(status.host, status.port);
  return { target, proxy: status, dns, proxyTcp: proxy, recommendation: !status.enabled && proxy.ok ? "proxy_available_enable_with_permission" : status.enabled && !proxy.ok ? "proxy_configured_but_unreachable" : "no_proxy_change_suggested" };
}

const TargetParameters = Type.Object({ target: Type.Optional(Type.String({ description: "Hostname to resolve for diagnostics. Defaults to github.com." })) });

async function permissionedProxyChange(ctx: ExtensionContext, enable: boolean): Promise<Record<string, unknown>> {
  const decision = await requestPermission(ctx, {
    tool: "proxy",
    action: enable ? "enable local proxy" : "disable local proxy",
    target: `${proxyHost()}:${proxyPort()}`,
    risk: "medium",
    impact: ["network-environment"],
  }, `${enable ? "Enable" : "Disable"} local proxy ${proxyHost()}:${proxyPort()}`);
  if (decision.effect !== "allow") return { changed: false, status: readProxyStatus(), comment: decision.comment, reason: "permission denied" };
  return { changed: true, status: setProxyEnvironment(enable), comment: decision.comment };
}

export default function proxyTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "proxy_status",
    label: "Proxy status",
    description: "Report the current proxy environment inherited by Pi and its child processes.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      return { content: [{ type: "text", text: JSON.stringify(readProxyStatus(), null, 2) }] };
    },
  });
  pi.registerTool({
    name: "proxy_diagnose",
    label: "Proxy diagnose",
    description: "Run bounded DNS and proxy TCP diagnostics for a public target without changing network settings.",
    parameters: TargetParameters,
    async execute(_id, params: { target?: string }) {
      const result = await diagnoseProxy(params.target ?? DEFAULT_TARGET);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });
  pi.registerTool({
    name: "proxy_enable",
    label: "Enable proxy",
    description: "Enable the configured local proxy for the current Pi process after explicit permission.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const result = await permissionedProxyChange(ctx, true);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.changed };
    },
  });
  pi.registerTool({
    name: "proxy_disable",
    label: "Disable proxy",
    description: "Disable proxy variables for the current Pi process after explicit permission.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const result = await permissionedProxyChange(ctx, false);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.changed };
    },
  });
}
