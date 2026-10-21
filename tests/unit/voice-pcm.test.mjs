import test from "node:test";
import assert from "node:assert/strict";
import { encodeVoicePcm, inspectVoicePcm, MAX_PCM_WAV_BYTES } from "../../src/lib/voice-pcm.mjs";
const canonical = () => encodeVoicePcm([new Float32Array(16000)], 16000);
test("canonical silence has duration derived from exact PCM bytes", () => {
  const bytes = canonical();
  assert.equal(bytes.length, 32044);
  assert.deepEqual(inspectVoicePcm(bytes), {
    durationSeconds: 1,
    sampleRate: 16000,
    samples: 16000,
  });
  assert.ok(bytes.slice(44).every((value) => value === 0));
});
test("60 second maximum accepted, overlimit and subminimum rejected", () => {
  const max = encodeVoicePcm([new Float32Array(16000 * 60)], 16000);
  assert.equal(max.length, MAX_PCM_WAV_BYTES);
  assert.equal(inspectVoicePcm(max).durationSeconds, 60);
  assert.throws(() => encodeVoicePcm([new Float32Array(16000 * 60 + 1)], 16000), /duration/);
  assert.throws(() => encodeVoicePcm([new Float32Array(1599)], 16000), /duration/);
  assert.equal(
    inspectVoicePcm(encodeVoicePcm([new Float32Array(1600)], 16000)).durationSeconds,
    0.1,
  );
});
test("reject malformed header sizes/rates/channels/chunk identities and compressed formats", () => {
  for (const [offset, value, width] of [
    [4, 1, 4],
    [16, 18, 4],
    [20, 3, 2],
    [22, 2, 2],
    [24, 8000, 4],
    [28, 1, 4],
    [32, 1, 2],
    [34, 8, 2],
    [40, 10, 4],
    [40, 32001, 4],
  ]) {
    const bytes = canonical();
    const view = new DataView(bytes.buffer);
    width === 4 ? view.setUint32(offset, value, true) : view.setUint16(offset, value, true);
    assert.throws(() => inspectVoicePcm(bytes), /invalid_pcm/);
  }
  for (const offset of [0, 8, 12, 36]) {
    const bytes = canonical();
    bytes[offset] = 0;
    assert.throws(() => inspectVoicePcm(bytes), /invalid_pcm/);
  }
});
test("reject truncation, extra trailing samples/chunks and fake sizes", () => {
  const bytes = canonical();
  assert.throws(() => inspectVoicePcm(bytes.slice(0, -1)), /invalid_pcm/);
  const trailing = new Uint8Array(bytes.length + 2);
  trailing.set(bytes);
  assert.throws(() => inspectVoicePcm(trailing), /invalid_pcm/);
  new DataView(trailing.buffer).setUint32(4, trailing.length - 8, true);
  assert.throws(() => inspectVoicePcm(trailing), /invalid_pcm/);
  assert.throws(() => inspectVoicePcm(new Uint8Array(MAX_PCM_WAV_BYTES + 1)), /invalid_pcm/);
  assert.throws(() => inspectVoicePcm(new Uint8Array(43)), /invalid_pcm/);
});
test("normalizes stereo48k to mono16k with bounded samples", () => {
  const left = new Float32Array(48000).fill(1);
  const right = new Float32Array(48000).fill(-1);
  const bytes = encodeVoicePcm([left, right], 48000);
  assert.equal(inspectVoicePcm(bytes).durationSeconds, 1);
  assert.ok(bytes.slice(44).every((value) => value === 0));
  const positive = encodeVoicePcm([new Float32Array(16000).fill(2)], 16000);
  assert.equal(new DataView(positive.buffer).getInt16(44, true), 32767);
});
test("reject excessive channels, sample rates, non-finite samples, unequal frames", () => {
  assert.throws(() =>
    encodeVoicePcm(
      [new Float32Array(16000), new Float32Array(16000), new Float32Array(16000)],
      16000,
    ),
  );
  assert.throws(() => encodeVoicePcm([new Float32Array(16000)], 384000));
  assert.throws(() => encodeVoicePcm([new Float32Array(16000), new Float32Array(8000)], 16000));
  assert.throws(() => encodeVoicePcm([new Float32Array(16000).fill(NaN)], 16000));
});
