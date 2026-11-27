import assert from "node:assert/strict";
import test from "node:test";
import {
  bindDeveloperSpeechVoice,
  developerSpeechFields,
  developerSpeechReceipt,
  runDeveloperSpeech,
  SPEECH_MODEL,
} from "../../src/lib/pricing/developer-speech-policy.mjs";
import { parseDeveloperInput } from "../../src/lib/pricing/developer-platform-policy.mjs";
const raw = { model: "speech", input: "Hello world", voice: "default" };
const body = bindDeveloperSpeechVoice(
  { model: SPEECH_MODEL, ...developerSpeechFields(raw) },
  "approved",
);
const options = { apiKey: "test-only", approvedVoice: "approved" };
const response = (headers = {}, bytes = Uint8Array.from([255, 251, 128, 0])) =>
  new Response(bytes, {
    headers: {
      "content-type": "audio/mpeg",
      "request-id": "fixture-request",
      "character-cost": "5",
      ...headers,
    },
  });
test("speech only accepts bounded text, a server-selected voice, and MP3", () => {
  assert.equal(parseDeveloperInput("audio/speech", raw).capability, "audio_speech");
  for (const invalid of [
    { ...raw, voice: "someone" },
    { ...raw, provider_voice: "approved" },
    { ...raw, input: "é".repeat(501) },
    { ...raw, input: "\ud800" },
    { ...raw, response_format: "wav" },
  ])
    assert.throws(() => developerSpeechFields(invalid), /speech_invalid/);
  assert.throws(() => bindDeveloperSpeechVoice(body, "../bad"), /speech_unavailable/);
});
test("speech adapter only sends the exact approved input and voice and retains actual provider usage", async () => {
  const calls = [];
  const result = await runDeveloperSpeech(body, {
    ...options,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response();
    },
  });
  const data = await result.json();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.elevenlabs.io/v1/text-to-speech/approved?output_format=mp3_44100_128",
  );
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    text: raw.input,
    model_id: SPEECH_MODEL,
    apply_text_normalization: "off",
  });
  assert.equal(data.generated, true);
  assert.deepEqual(developerSpeechReceipt(data), { speech_character_credits: 5 });
  assert.equal(data.audio, Buffer.from([255, 251, 128, 0]).toString("base64"));
});
test("speech rejects missing, excessive or forged receipts and invalid audio before returning content", async () => {
  for (const res of [
    response({ "request-id": "" }),
    response({ "character-cost": "" }),
    response({ "character-cost": "12" }),
    response({ "character-cost": "0" }),
    response({ "content-type": "text/html" }),
    response({}, new Uint8Array([1, 2, 3, 4])),
  ])
    await assert.rejects(
      runDeveloperSpeech(body, { ...options, fetchImpl: async () => res }),
      /speech_unavailable/,
    );
  await assert.rejects(
    runDeveloperSpeech(body, {
      ...options,
      approvedVoice: "different",
      fetchImpl: async () => assert.fail("dispatch"),
    }),
    /speech_unavailable/,
  );
});
