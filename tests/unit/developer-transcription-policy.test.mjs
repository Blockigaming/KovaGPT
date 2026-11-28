import assert from "node:assert/strict";
import test from "node:test";
import {
  developerTranscriptionAudio,
  developerTranscriptionFields,
  developerTranscriptionReceipt,
  developerTranscriptionResult,
  validDeveloperTranscriptionRequest,
} from "../../src/lib/pricing/developer-transcription-policy.mjs";

function wave(size = 3200) {
  const bytes = Buffer.alloc(44 + size);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(size, 40);
  return bytes;
}
const uri = (bytes) => "data:audio/wav;base64," + bytes.toString("base64");
const audio = uri(wave());

test("canonical PCM duration and header are bounded before provider dispatch", () => {
  assert.equal(developerTranscriptionAudio(audio).seconds, 0.1);
  assert.equal(developerTranscriptionAudio(uri(wave(640000))).seconds, 20);
  assert.throws(() => developerTranscriptionAudio(uri(wave(640002))), /transcription_invalid/);
  assert.throws(() => developerTranscriptionAudio(uri(wave(3198))), /transcription_invalid/);
  for (const [offset, value] of [
    [4, 0],
    [16, 17],
    [20, 3],
    [22, 2],
    [24, 8000],
    [28, 64000],
    [32, 4],
    [34, 8],
    [40, 0],
  ]) {
    const bytes = wave();
    bytes.writeUInt16LE(value, offset);
    assert.throws(() => developerTranscriptionAudio(uri(bytes)), /transcription_invalid/);
  }
  assert.throws(() => developerTranscriptionAudio(audio + "\n"), /transcription_invalid/);
});

test("request normalization rejects unapproved provider fields and legacy models", () => {
  assert.throws(
    () => developerTranscriptionFields({ model: "kova-transcribe", audio, prompt: "extra" }),
    /transcription_invalid/,
  );
  const body = {
    model: "gpt-transcribe",
    ...developerTranscriptionFields({ model: "kova-transcribe", audio }),
  };
  assert.equal(validDeveloperTranscriptionRequest(body), true);
  assert.equal(validDeveloperTranscriptionRequest({ ...body, model: "whisper-1" }), false);
});

test("settlement requires an actual request ID and valid provider duration", () => {
  const result = developerTranscriptionResult(
    { text: "hello", usage: { type: "duration", seconds: 0.1 } },
    "req_123",
  );
  assert.deepEqual(developerTranscriptionReceipt(result), { transcription_seconds: 0.1 });
  for (const seconds of [0, -1, NaN, Infinity, 601])
    assert.throws(
      () =>
        developerTranscriptionResult(
          { text: "a", usage: { type: "duration", seconds } },
          "req_123",
        ),
      /transcription_unavailable/,
    );
  assert.throws(
    () =>
      developerTranscriptionResult({ text: "a", usage: { type: "tokens", seconds: 1 } }, "req_123"),
    /transcription_unavailable/,
  );
  assert.throws(
    () =>
      developerTranscriptionResult({ text: "a", usage: { type: "duration", seconds: 1 } }, null),
    /transcription_unavailable/,
  );
});
