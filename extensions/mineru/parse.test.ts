import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
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
  });

  assert.equal(result.status, "ready");
  assert.equal(result.batchId, "batch-1");
  assert.equal(result.preview, markdown);
  assert.equal(await readFile(result.resultPath!, "utf8"), markdown);
  assert.equal(uploadedBytes, Buffer.byteLength("%PDF-1.7\nfixture"));
  assert.equal(uploadedText, "%PDF-1.7\nfixture");
  assert.deepEqual(states, ["validating", "requesting-upload", "uploading", "polling", "downloading", "materializing", "ready"]);
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
  await assert.rejects(parseWithMineru({ path: source }, undefined, { env }), /not authorized/);
});
