import { open, realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

export const MINERU_MAX_INPUT_BYTES = 200 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp",
  ".doc", ".docx",
  ".ppt", ".pptx",
  ".xls", ".xlsx",
]);

const SECRET_BASENAME_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^(?:credentials?|secrets?|tokens?)(?:\.|$)/i,
  /authorized_keys$/i,
  /known_hosts$/i,
];

export type ValidatedMineruInput = {
  path: string;
  filename: string;
  extension: string;
  size: number;
};

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function signatureMatches(extension: string, bytes: Uint8Array): boolean {
  if (extension === ".pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (extension === ".png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === ".jpg" || extension === ".jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (extension === ".gif") return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
  if (extension === ".bmp") return startsWith(bytes, [0x42, 0x4d]);
  if (extension === ".webp") return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (extension === ".jp2") return startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]) || startsWith(bytes, [0xff, 0x4f, 0xff, 0x51]);
  if ([".docx", ".pptx", ".xlsx"].includes(extension)) return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if ([".doc", ".ppt", ".xls"].includes(extension)) return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return false;
}

export function isMineruImageExtension(extension: string): boolean {
  return new Set([".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp"]).has(extension.toLowerCase());
}

export async function validateMineruInput(inputPath: string): Promise<ValidatedMineruInput> {
  if (!inputPath.trim()) throw new Error("A local document path is required.");
  const resolved = await realpath(inputPath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("MinerU input must be a regular file.");
  if (info.size <= 0) throw new Error("MinerU input file is empty.");
  if (info.size > MINERU_MAX_INPUT_BYTES) throw new Error("MinerU input exceeds the 200 MB limit.");

  const filename = basename(resolved);
  if (SECRET_BASENAME_PATTERNS.some((pattern) => pattern.test(filename))) {
    throw new Error(`Refusing to upload a credential or secret-like file: ${filename}`);
  }

  const extension = extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported MinerU file type: ${extension || "no extension"}`);

  const handle = await open(resolved, "r");
  try {
    const probe = Buffer.alloc(16);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    if (!signatureMatches(extension, probe.subarray(0, bytesRead))) {
      throw new Error(`File signature does not match extension ${extension}.`);
    }
  } finally {
    await handle.close();
  }

  return { path: resolved, filename, extension, size: info.size };
}
