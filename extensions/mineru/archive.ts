import { createWriteStream } from "node:fs";
import { mkdir, open as openFile, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { once } from "node:events";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export const MAX_ZIP_ENTRIES = 4096;
export const MAX_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_MARKDOWN_BYTES = 64 * 1024 * 1024;
export const DEFAULT_PREVIEW_CHARS = 6000;

export type MaterializedMarkdown = {
  resultPath: string;
  characters: number;
  preview: string;
};

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("Cannot open MinerU result ZIP."));
      else resolvePromise(zip);
    });
  });
}

export function validateMineruZipEntry(entry: Entry, root: string): void {
  const name = entry.fileName;
  if (!name || name.includes("\\") || name.includes("\0") || isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`Unsafe ZIP entry path: ${name || "empty"}`);
  }
  const normalized = resolve(root, name);
  const rel = relative(root, normalized);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error(`ZIP entry escapes the job directory: ${name}`);
  }
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (mode === 0o120000) throw new Error(`ZIP symlink entries are not allowed: ${name}`);
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error(`Encrypted ZIP entries are not allowed: ${name}`);
  if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(`ZIP entry exceeds the size limit: ${name}`);
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Cannot read ZIP entry ${entry.fileName}.`));
      else resolvePromise(stream);
    });
  });
}

async function writeMarkdown(zip: ZipFile, entry: Entry, destination: string, previewLimit: number): Promise<MaterializedMarkdown> {
  if (entry.uncompressedSize > MAX_MARKDOWN_BYTES) throw new Error("MinerU full.md exceeds the Markdown size limit.");
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const output = createWriteStream(destination, { mode: 0o600 });
  const stream = await openEntryStream(zip, entry);
  const decoder = new StringDecoder("utf8");
  let bytes = 0;
  let characters = 0;
  let preview = "";
  try {
    for await (const raw of stream as AsyncIterable<Buffer | Uint8Array>) {
      const chunk = Buffer.from(raw);
      bytes += chunk.byteLength;
      if (bytes > MAX_MARKDOWN_BYTES) throw new Error("MinerU full.md exceeds the Markdown size limit.");
      const text = decoder.write(chunk);
      characters += text.length;
      if (preview.length < previewLimit) preview += text.slice(0, previewLimit - preview.length);
      if (!output.write(chunk)) await once(output, "drain");
    }
    const tail = decoder.end();
    characters += tail.length;
    if (preview.length < previewLimit) preview += tail.slice(0, previewLimit - preview.length);
    output.end();
    await once(output, "close");
    return { resultPath: destination, characters, preview };
  } catch (error) {
    output.destroy();
    await rm(destination, { force: true });
    throw error;
  }
}

export async function materializeMineruMarkdown(
  zipPath: string,
  jobDir: string,
  previewLimit = DEFAULT_PREVIEW_CHARS,
): Promise<MaterializedMarkdown> {
  const root = resolve(jobDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const zip = await openZip(zipPath);
  let entryCount = 0;
  let totalBytes = 0;
  let markdownEntry: Entry | undefined;
  let materializedMarkdown: MaterializedMarkdown | undefined;

  return new Promise<MaterializedMarkdown>((resolvePromise, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      const normalized = error instanceof Error ? error : new Error(String(error));
      void rm(join(root, "full.md"), { force: true }).finally(() => reject(normalized));
    };

    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        try {
          entryCount += 1;
          if (entryCount > MAX_ZIP_ENTRIES) throw new Error("MinerU result ZIP has too many entries.");
          validateMineruZipEntry(entry, root);
          totalBytes += entry.uncompressedSize;
          if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw new Error("MinerU result ZIP exceeds the total expanded size limit.");

          if (!entry.fileName.endsWith("/") && basename(entry.fileName) === "full.md") {
            if (markdownEntry) throw new Error("MinerU result ZIP contains multiple full.md entries.");
            markdownEntry = entry;
            materializedMarkdown = await writeMarkdown(zip, entry, join(root, "full.md"), previewLimit);
          }
          zip.readEntry();
        } catch (error) {
          fail(error);
        }
      })();
    });
    zip.on("end", () => {
      if (settled) return;
      if (!materializedMarkdown) {
        fail(new Error("MinerU result ZIP does not contain full.md."));
        return;
      }
      settled = true;
      resolvePromise(materializedMarkdown);
    });
    zip.readEntry();
  });
}

export async function readPreview(path: string, maxBytes = 24_000): Promise<string> {
  const handle = await openFile(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
