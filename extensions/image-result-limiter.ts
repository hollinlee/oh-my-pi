import { PhotonImage, SamplingFilter, resize } from "@silvia-odwyer/photon-node";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_MAX_BINARY_BYTES = 350 * 1024;
const DEFAULT_MAX_EDGE = 1280;
const JPEG_QUALITIES = [78, 68, 58, 48];

type ContentPart = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

export type ImageLimitOptions = {
  maxBinaryBytes?: number;
  maxEdge?: number;
};

export type ImageLimitSummary = {
  images: number;
  changed: number;
  dropped: number;
  originalBytes: number;
  outputBytes: number;
};

function binaryBytes(base64: string): number {
  return Buffer.byteLength(base64, "base64");
}

function encodeBoundedImage(data: string, maxBinaryBytes: number, maxEdge: number): { data: string; width: number; height: number } | undefined {
  let image: PhotonImage | undefined;
  try {
    image = PhotonImage.new_from_byteslice(Buffer.from(data, "base64"));
    let width = image.get_width();
    let height = image.get_height();
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale < 1) {
      const resized = resize(image, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), SamplingFilter.Lanczos3);
      image.free();
      image = resized;
      width = image.get_width();
      height = image.get_height();
    }

    while (true) {
      for (const quality of JPEG_QUALITIES) {
        const bytes = Buffer.from(image.get_bytes_jpeg(quality));
        if (bytes.length <= maxBinaryBytes) return { data: bytes.toString("base64"), width, height };
      }
      if (Math.max(width, height) <= 480) break;
      const nextWidth = Math.max(1, Math.round(width * 0.8));
      const nextHeight = Math.max(1, Math.round(height * 0.8));
      const resized = resize(image, nextWidth, nextHeight, SamplingFilter.Lanczos3);
      image.free();
      image = resized;
      width = nextWidth;
      height = nextHeight;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    image?.free();
  }
}

export function limitImageContent(content: readonly ContentPart[], options: ImageLimitOptions = {}): { content: ContentPart[]; summary: ImageLimitSummary } {
  const maxBinaryBytes = options.maxBinaryBytes ?? DEFAULT_MAX_BINARY_BYTES;
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const summary: ImageLimitSummary = { images: 0, changed: 0, dropped: 0, originalBytes: 0, outputBytes: 0 };
  const output: ContentPart[] = [];

  for (const part of content) {
    if (part.type !== "image" || !part.data) {
      output.push(part);
      continue;
    }
    summary.images += 1;
    const originalBytes = binaryBytes(part.data);
    summary.originalBytes += originalBytes;
    if (originalBytes <= maxBinaryBytes) {
      summary.outputBytes += originalBytes;
      output.push(part);
      continue;
    }

    const encoded = encodeBoundedImage(part.data, maxBinaryBytes, maxEdge);
    summary.changed += 1;
    if (!encoded) {
      summary.dropped += 1;
      output.push({ type: "text", text: `[Image omitted: ${originalBytes} bytes could not be safely reduced below ${maxBinaryBytes} bytes.]` });
      continue;
    }
    const outputBytes = binaryBytes(encoded.data);
    summary.outputBytes += outputBytes;
    output.push({ type: "image", data: encoded.data, mimeType: "image/jpeg" });
    output.push({
      type: "text",
      text: `[Image payload reduced from ${originalBytes} to ${outputBytes} bytes at ${encoded.width}x${encoded.height} for bounded model/session context.]`,
    });
  }

  return { content: output, summary };
}

export default function imageResultLimiter(pi: ExtensionAPI) {
  pi.on("tool_result", (event) => {
    if (event.toolName !== "read" || process.env.OH_MY_PI_IMAGE_LIMIT_DISABLED === "1") return;
    if (!event.content.some((part) => part.type === "image")) return;
    const maxBinaryBytes = Number(process.env.OH_MY_PI_IMAGE_MAX_BYTES) || DEFAULT_MAX_BINARY_BYTES;
    const maxEdge = Number(process.env.OH_MY_PI_IMAGE_MAX_EDGE) || DEFAULT_MAX_EDGE;
    const limited = limitImageContent(event.content as ContentPart[], { maxBinaryBytes, maxEdge });
    if (limited.summary.changed === 0) return;
    return {
      content: limited.content as typeof event.content,
      details: { ...(event.details && typeof event.details === "object" ? event.details : {}), imageLimiter: limited.summary },
    };
  });
}
