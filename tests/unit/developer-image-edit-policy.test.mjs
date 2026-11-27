import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  developerImageEditBytes,
  bindDeveloperImageInput,
} from "../../src/lib/pricing/developer-image-edit-policy.mjs";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=";
const body = { model: "gpt-image", prompt: "edit", n: 1, size: "1024x1024", quality: "medium" };
const bytes = developerImageEditBytes(image);
const input = { image: { bytes, contentType: "image/png" } };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("multipart binding reproduces the signed request body byte for byte", () => {
  assert.equal(hash(bindDeveloperImageInput(body, input)), hash({ ...body, image }));
  const changed = Buffer.from(bytes);
  changed[changed.length - 5] ^= 1;
  assert.notEqual(
    hash(bindDeveloperImageInput(body, { image: { bytes: changed, contentType: "image/png" } })),
    hash({ ...body, image }),
  );
});
test("multipart binding rejects masks, conflicting input fields and unsupported image bytes", () => {
  for (const invalid of [
    { ...input, mask: input.image },
    { image: { ...input.image, contentType: "image/jpeg" } },
    { image: { ...input.image, bytes: new Uint8Array(32769) } },
  ])
    assert.throws(() => bindDeveloperImageInput(body, invalid), /image_invalid/);
  assert.throws(() => bindDeveloperImageInput({ ...body, image }, input), /image_invalid/);
});
