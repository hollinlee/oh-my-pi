import assert from "node:assert/strict";
import test from "node:test";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { limitImageContent } from "../image-result-limiter.ts";

function noisyPng(width: number, height: number): string {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    const value = (index * 31 + (index >>> 3) * 17) % 256;
    pixels[index] = value;
    pixels[index + 1] = (value * 7) % 256;
    pixels[index + 2] = (value * 13) % 256;
    pixels[index + 3] = 255;
  }
  const image = new PhotonImage(pixels, width, height);
  try {
    return Buffer.from(image.get_bytes()).toString("base64");
  } finally {
    image.free();
  }
}

test("small image payloads pass through unchanged", () => {
  const data = noisyPng(16, 16);
  const input = [{ type: "image", data, mimeType: "image/png" }];
  const result = limitImageContent(input, { maxBinaryBytes: 20_000 });
  assert.equal(result.summary.changed, 0);
  assert.equal(result.content[0]?.data, data);
});

test("large image payloads are converted to bounded visual input", () => {
  const data = noisyPng(1200, 900);
  const result = limitImageContent([{ type: "image", data, mimeType: "image/png" }], {
    maxBinaryBytes: 120_000,
    maxEdge: 800,
  });
  const image = result.content.find((part) => part.type === "image");
  assert.equal(result.summary.images, 1);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.summary.dropped, 0);
  assert.equal(image?.mimeType, "image/jpeg");
  assert.ok(image?.data);
  assert.ok(Buffer.byteLength(image!.data!, "base64") <= 120_000);
  assert.ok(result.summary.outputBytes < result.summary.originalBytes);
});

test("undecodable oversized images are omitted instead of bloating the session", () => {
  const data = Buffer.alloc(2000, 7).toString("base64");
  const result = limitImageContent([{ type: "image", data, mimeType: "image/png" }], { maxBinaryBytes: 100 });
  assert.equal(result.summary.dropped, 1);
  assert.equal(result.content.some((part) => part.type === "image"), false);
  assert.match(result.content[0]?.text ?? "", /Image omitted/);
});
