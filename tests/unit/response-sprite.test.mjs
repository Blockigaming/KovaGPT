import assert from "node:assert/strict";
import test from "node:test";
import { imageSheetInstructions, imageSheetKind } from "../../src/lib/ai/image-prompt-policy.mjs";
import { createGifWriter, spriteFrames } from "../../src/lib/response-sprite.ts";

test("a sprite grid covers odd dimensions in row-major order", () => {
  assert.deepEqual(spriteFrames(9, 5, { columns: 2, rows: 2 }), [
    { x: 0, y: 0, width: 4, height: 2 },
    { x: 4, y: 0, width: 5, height: 2 },
    { x: 0, y: 2, width: 4, height: 3 },
    { x: 4, y: 2, width: 5, height: 3 },
  ]);
  assert.throws(() => spriteFrames(100, 100, { columns: 8, rows: 8 }));
  assert.throws(() => spriteFrames(1, 1, { columns: 2, rows: 1 }));
});

test("the GIF encoder writes distinct timed frames and a trailer", () => {
  const writer = createGifWriter(2, 1, 160);
  writer.write(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]));
  writer.write(new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 0, 0]));
  const bytes = Buffer.from(writer.finish());
  assert.equal(bytes.toString("ascii", 0, 6), "GIF89a");
  assert.equal(bytes.at(-1), 0x3b);
  const control = Buffer.from([0x21, 0xf9, 0x04]);
  const first = bytes.indexOf(control);
  const second = bytes.indexOf(control, first + control.length);
  assert.ok(first > 0 && second > first);
  assert.equal(bytes.readUInt16LE(first + 4), 16);
  assert.equal(bytes.readUInt16LE(second + 4), 16);
});

test("GIF and sticker prompts request an ordered image sheet, with ordinary prompts unchanged", () => {
  assert.equal(imageSheetKind("Create a looping GIF of a cat"), "animation");
  assert.equal(imageSheetKind("Create a sticker pack of cats"), "stickers");
  assert.equal(imageSheetInstructions(imageSheetKind("Create a photo of a cat")), "");
  assert.match(imageSheetInstructions("animation"), /4-column by 2-row/);
  assert.match(imageSheetInstructions("stickers"), /eight different stickers/);
});
