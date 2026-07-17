import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateMineruInput } from "./input.ts";

async function root() {
  return mkdtemp(join(tmpdir(), "mineru-input-"));
}

test("validates a regular PDF by canonical path and signature", async () => {
  const dir = await root();
  const path = join(dir, "report.pdf");
  await writeFile(path, Buffer.from("%PDF-1.7\nfixture"));
  const result = await validateMineruInput(path);
  assert.equal(result.path, await realpath(path));
  assert.equal(result.extension, ".pdf");
  assert.equal(result.filename, "report.pdf");
  await result.handle.close();
});

test("rejects directories, empty files, unsupported formats, and signature mismatches", async () => {
  const dir = await root();
  await assert.rejects(validateMineruInput(dir), /regular file/);

  const empty = join(dir, "empty.pdf");
  await writeFile(empty, "");
  await assert.rejects(validateMineruInput(empty), /empty/);

  const unsupported = join(dir, "notes.txt");
  await writeFile(unsupported, "hello");
  await assert.rejects(validateMineruInput(unsupported), /Unsupported/);

  const mismatch = join(dir, "fake.pdf");
  await writeFile(mismatch, "not a pdf");
  await assert.rejects(validateMineruInput(mismatch), /signature/);
});

test("rejects obvious credential filenames", async () => {
  const dir = await root();
  const path = join(dir, ".env.prod");
  await writeFile(path, Buffer.from("%PDF-1.7\nsecret"));
  await assert.rejects(validateMineruInput(path), /credential or secret-like/);
});

test("rejects non-file paths even when nested directories exist", async () => {
  const dir = await root();
  const nested = join(dir, "nested.pdf");
  await mkdir(nested);
  await assert.rejects(validateMineruInput(nested), /regular file/);
});
