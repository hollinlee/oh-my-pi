import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { writeMineruAuthorization } from "./config.ts";
import { parseWithMineru } from "./parse.ts";
import type { MineruFetch } from "./client.ts";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("single-file happy path uploads, polls, materializes Markdown, and never persists the token", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-parse-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nfixture"));
  const env = { MINERU_TOKEN: "live-secret-must-not-leak", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir, now: () => new Date("2026-07-17T00:00:00.000Z") });

  const markdown = "# Parsed report\n\nRevenue: 42\n";
  const zip = zipSync({ "result/full.md": strToU8(markdown), "result/content_list.json": strToU8("[]") });
  const calls: Array<{ url: string; method: string }> = [];
  let uploadedBytes = 0;
  let uploadedText = "";

  const mockFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method });
    const headers = new Headers(init.headers);
    if (url === "https://mock.mineru/api/v4/file-urls/batch") {
      assert.equal(headers.get("authorization"), "Bearer live-secret-must-not-leak");
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(payload.model_version, "vlm");
      assert.equal(payload.language, "en");
      assert.equal(payload.enable_formula, true);
      assert.equal(payload.enable_table, true);
      assert.deepEqual(payload.files, [{ name: "report.pdf", is_ocr: false }]);
      await rename(source, `${source}.validated`);
      await writeFile(source, Buffer.from("%PDF-1.7\nreplacement-secret"));
      return jsonResponse({ code: 0, data: { batch_id: "batch-1", file_urls: ["https://upload.test/file"] }, trace_id: "trace-submit" });
    }
    if (url === "https://upload.test/file") {
      assert.equal(headers.has("authorization"), false);
      for await (const chunk of init.body as unknown as AsyncIterable<Buffer | Uint8Array>) {
        const buffer = Buffer.from(chunk);
        uploadedBytes += buffer.byteLength;
        uploadedText += buffer.toString("utf8");
      }
      return new Response(null, { status: 200 });
    }
    if (url === "https://mock.mineru/api/v4/extract-results/batch/batch-1") {
      assert.equal(headers.get("authorization"), "Bearer live-secret-must-not-leak");
      return jsonResponse({ code: 0, data: { extract_result: [{ state: "done", full_zip_url: "https://download.test/result.zip" }] }, trace_id: "trace-result" });
    }
    if (url === "https://download.test/result.zip") {
      assert.equal(headers.has("authorization"), false);
      return new Response(zip, { status: 200 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as MineruFetch;

  const states: string[] = [];
  const result = await parseWithMineru({ path: source, language: "en", max_wait_seconds: 5 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
    now: () => new Date("2026-07-17T00:00:00.000Z"),
    onState: (state) => states.push(state),
    remove: async (path, options) => {
      if (path.endsWith("result.zip")) throw new Error("simulated cleanup failure");
      await rm(path, options);
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.batchId, "batch-1");
  assert.equal(result.preview, markdown);
  assert.match(result.warning ?? "", /simulated cleanup failure/);
  assert.equal(await readFile(result.resultPath!, "utf8"), markdown);
  assert.equal(uploadedBytes, Buffer.byteLength("%PDF-1.7\nfixture"));
  assert.equal(uploadedText, "%PDF-1.7\nfixture");
  assert.deepEqual(states, ["validating", "requesting-upload", "uploading", "polling", "polling: done", "downloading", "materializing", "ready"]);
  assert.deepEqual(calls.map((call) => call.method), ["POST", "PUT", "GET", "GET"]);

  const manifest = await readFile(join(stateDir, "jobs", result.jobId!, "manifest.json"), "utf8");
  assert.equal(manifest.includes("live-secret-must-not-leak"), false);
  assert.match(manifest, /"state": "ready"/);
});

test("fails closed when authorization is missing", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-parse-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nfixture"));
  const env = { MINERU_TOKEN: "configured", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  const result = await parseWithMineru({ path: source }, undefined, { env });
  assert.equal(result.status, "failed");
  assert.equal(result.category, "auth");
  assert.match(result.error ?? "", /not authorized/);
  assert.equal(result.remoteMayContinue, false);
});

test("cancel after submit persists a resumable job without repeating upload", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-resume-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nresume"));
  const env = { MINERU_TOKEN: "secret", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir });
  const zip = zipSync({ "full.md": strToU8("# Resumed\n") });
  const controller = new AbortController();
  let mode: "cancel" | "resume" = "cancel";
  let submits = 0;
  let uploads = 0;

  const mockFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/file-urls/batch")) {
      submits += 1;
      return jsonResponse({ code: 0, data: { batch_id: "batch-resume", file_urls: ["https://upload.test/resume"] } });
    }
    if (url === "https://upload.test/resume") {
      uploads += 1;
      for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) { /* consume */ }
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/extract-results/batch/batch-resume")) {
      if (mode === "cancel") {
        controller.abort(new Error("user cancelled"));
        return jsonResponse({ code: 0, data: { extract_result: [{ state: "pending" }] } });
      }
      return jsonResponse({ code: 0, data: { extract_result: [{ state: "done", full_zip_url: "https://download.test/resume.zip" }] } });
    }
    if (url === "https://download.test/resume.zip") return new Response(zip, { status: 200 });
    throw new Error(`Unexpected request ${url}`);
  }) as MineruFetch;

  const cancelled = await parseWithMineru({ path: source, max_wait_seconds: 5 }, controller.signal, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
  });
  assert.equal(cancelled.status, "cancelled-local");
  assert.equal(cancelled.remoteMayContinue, true);
  assert.equal(cancelled.batchId, "batch-resume");
  assert.ok(cancelled.jobId);

  mode = "resume";
  const resumed = await parseWithMineru({ job_id: cancelled.jobId!, max_wait_seconds: 5 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
  });
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.preview, "# Resumed\n");
  assert.equal(submits, 1);
  assert.equal(uploads, 1);
});

test("polling honors Retry-After and retries an idempotent 429", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-retry-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nretry"));
  const env = { MINERU_TOKEN: "secret", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir });
  const zip = zipSync({ "full.md": strToU8("# Retried\n") });
  let polls = 0;

  const mockFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/file-urls/batch")) return jsonResponse({ code: 0, data: { batch_id: "batch-retry", file_urls: ["https://upload.test/retry"] } });
    if (url === "https://upload.test/retry") {
      for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) { /* consume */ }
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/extract-results/batch/batch-retry")) {
      polls += 1;
      if (polls === 1) return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
      return jsonResponse({ code: 0, data: { extract_result: [{ state: "done", full_zip_url: "https://download.test/retry.zip" }] } });
    }
    if (url === "https://download.test/retry.zip") return new Response(zip, { status: 200 });
    throw new Error(`Unexpected request ${url}`);
  }) as MineruFetch;

  const result = await parseWithMineru({ path: source, max_wait_seconds: 5 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
    random: () => 0,
  });
  assert.equal(result.status, "ready");
  assert.equal(polls, 2);
});

test("ambiguous submit network failure is not retried and warns that remote work may continue", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-submit-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nsubmit"));
  const env = { MINERU_TOKEN: "secret", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir });
  let submits = 0;
  const mockFetch = (async () => {
    submits += 1;
    throw new TypeError("connection reset after submit");
  }) as MineruFetch;

  const result = await parseWithMineru({ path: source, max_wait_seconds: 5 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stage, "requesting-upload");
  assert.equal(result.remoteMayContinue, true);
  assert.equal(submits, 1);
});

test("remote failed is terminal, preserves trace ID, and is not retried", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-remote-failed-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nfailed"));
  const env = { MINERU_TOKEN: "secret", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir });
  let polls = 0;
  const mockFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/file-urls/batch")) return jsonResponse({ code: 0, data: { batch_id: "batch-failed", file_urls: ["https://upload.test/failed"] } });
    if (url === "https://upload.test/failed") {
      for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) { /* consume */ }
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/extract-results/batch/batch-failed")) {
      polls += 1;
      return jsonResponse({ code: 0, data: { extract_result: [{ state: "failed", err_code: "-60010", err_msg: "parse failed" }] }, trace_id: "trace-failed" });
    }
    throw new Error(`Unexpected request ${url}`);
  }) as MineruFetch;

  const result = await parseWithMineru({ path: source, max_wait_seconds: 5 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "-60010");
  assert.equal(result.traceId, "trace-failed");
  assert.equal(result.remoteMayContinue, false);
  assert.equal(polls, 1);
});

test("expired token is an auth failure and submit is not retried", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-auth-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\nauth"));
  const env = { MINERU_TOKEN: "expired", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir });
  let submits = 0;
  const mockFetch = (async () => {
    submits += 1;
    return jsonResponse({ code: "A0211", msg: "token expired", trace_id: "trace-auth", data: {} });
  }) as MineruFetch;
  const result = await parseWithMineru({ path: source, max_wait_seconds: 5 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.category, "auth");
  assert.equal(result.code, "A0211");
  assert.equal(result.traceId, "trace-auth");
  assert.equal(submits, 1);
});

test("local wall-clock timeout returns a resumable remote handle", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "mineru-timeout-"));
  const source = join(stateDir, "report.pdf");
  await writeFile(source, Buffer.from("%PDF-1.7\ntimeout"));
  const env = { MINERU_TOKEN: "secret", PI_MINERU_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  await writeMineruAuthorization({ env, stateDir });
  const mockFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/file-urls/batch")) return jsonResponse({ code: 0, data: { batch_id: "batch-timeout", file_urls: ["https://upload.test/timeout"] } });
    if (url === "https://upload.test/timeout") {
      for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) { /* consume */ }
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/extract-results/batch/batch-timeout")) return jsonResponse({ code: 0, data: { extract_result: [{ state: "pending" }] } });
    throw new Error(`Unexpected request ${url}`);
  }) as MineruFetch;

  const result = await parseWithMineru({ path: source, max_wait_seconds: 1 }, undefined, {
    env,
    baseUrl: "https://mock.mineru/api/v4",
    fetch: mockFetch,
  });
  assert.equal(result.status, "timed-out-local");
  assert.equal(result.category, "timeout");
  assert.equal(result.remoteMayContinue, true);
  assert.equal(result.batchId, "batch-timeout");
});
