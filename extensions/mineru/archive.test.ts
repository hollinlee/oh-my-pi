import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import type { Entry } from "yauzl";
import {
  materializeMineruMarkdown,
  MAX_ZIP_ENTRY_BYTES,
  validateMineruZipEntry,
} from "./archive.ts";

async function fixture(entries: Record<string, Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), "mineru-archive-"));
  const zipPath = join(root, "result.zip");
  await writeFile(zipPath, zipSync(entries));
  return { root, zipPath, jobDir: join(root, "job") };
}

function fakeEntry(fileName: string, overrides: Partial<Entry> = {}): Entry {
  return {
    fileName,
    externalFileAttributes: 0,
    generalPurposeBitFlag: 0,
    uncompressedSize: 10,
    ...overrides,
  } as Entry;
}

test("materializes only full.md and returns a bounded preview", async () => {
  const markdown = "# Report\n\n" + "value ".repeat(2000);
  const { zipPath, jobDir } = await fixture({
    "document/full.md": strToU8(markdown),
    "document/content_list.json": strToU8("[]"),
    "document/images/chart.png": new Uint8Array([1, 2, 3]),
  });
  const result = await materializeMineruMarkdown(zipPath, jobDir, 120);
  assert.equal(result.preview.length, 120);
  assert.equal(result.characters, markdown.length);
  assert.equal(await readFile(result.resultPath, "utf8"), markdown);
  await assert.rejects(readFile(join(jobDir, "content_list.json")), /ENOENT/);
});

test("rejects missing or duplicate full.md entries", async () => {
  const missing = await fixture({ "content.json": strToU8("{}") });
  await assert.rejects(materializeMineruMarkdown(missing.zipPath, missing.jobDir), /does not contain full.md/);

  const duplicate = await fixture({
    "a/full.md": strToU8("a"),
    "b/full.md": strToU8("b"),
  });
  await assert.rejects(materializeMineruMarkdown(duplicate.zipPath, duplicate.jobDir), /multiple full.md/);
  await assert.rejects(readFile(join(duplicate.jobDir, "full.md")), /ENOENT/);
});

test("rejects path traversal, absolute paths, symlinks, encrypted and oversized entries", () => {
  const root = "/safe/job";
  assert.throws(() => validateMineruZipEntry(fakeEntry("../escape"), root), /escapes|Unsafe/);
  assert.throws(() => validateMineruZipEntry(fakeEntry("/absolute"), root), /Unsafe/);
  assert.throws(() => validateMineruZipEntry(fakeEntry("link", { externalFileAttributes: 0o120000 << 16 }), root), /symlink/);
  assert.throws(() => validateMineruZipEntry(fakeEntry("encrypted", { generalPurposeBitFlag: 1 }), root), /Encrypted/);
  assert.throws(() => validateMineruZipEntry(fakeEntry("large", { uncompressedSize: MAX_ZIP_ENTRY_BYTES + 1 }), root), /size limit/);
});
