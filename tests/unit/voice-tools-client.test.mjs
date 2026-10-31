import test from "node:test";
import assert from "node:assert/strict";
import { encodeVoicePcm } from "../../src/lib/voice-pcm.mjs";
import { loadVoiceTools, submitVoiceTool } from "../../src/lib/voice-tools-client.mjs";

const configured = {
  configured: true,
  tts: true,
  stt: true,
  sts: true,
  voices: [{ id: "default", label: "Default voice", available: true }],
  defaultVoiceId: "default",
};
const wav = () =>
  new Blob([encodeVoicePcm([new Float32Array(1600)], 16000)], { type: "audio/wav" });
test("audio capability reads are owner-bound and malformed catalogs fail closed", async () => {
  const calls = [];
  assert.deepEqual(
    await loadVoiceTools("owner-one", {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json(configured);
      },
    }),
    configured,
  );
  assert.equal(calls[0].url, "/api/voice");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers["x-kova-voice-owner"], "owner-one");
  for (const body of [
    { ...configured, sts: "true" },
    { ...configured, voices: [{ label: "Undefined ID", available: true }] },
    { ...configured, defaultVoiceId: "locked" },
    { ...configured, voices: [{ ...configured.voices[0], available: false }] },
  ])
    await assert.rejects(
      loadVoiceTools("owner-one", { fetchImpl: async () => Response.json(body) }),
      /unreadable/,
    );
});
test("standalone speech uses the configured opaque voice and returns actual audio bytes without retries", async () => {
  const calls = [];
  const result = await submitVoiceTool(
    { ownerId: "owner-one", action: "tts", text: "  Kova audio acceptance.  ", voiceId: "default" },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(new Uint8Array([73, 68, 51]), {
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers["x-kova-voice-owner"], "owner-one");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "tts",
    text: "Kova audio acceptance.",
    voiceId: "default",
  });
  assert.equal(result.audio.type, "audio/mpeg");
  assert.deepEqual(new Uint8Array(await result.audio.arrayBuffer()), new Uint8Array([73, 68, 51]));
});
test("transcription and transformation send only prepared PCM and transcription cannot choose a voice", async () => {
  const audio = wav();
  for (const action of ["stt", "sts"]) {
    const calls = [];
    const result = await submitVoiceTool(
      { ownerId: "owner-one", action, audio, voiceId: "default" },
      {
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return action === "stt"
            ? Response.json({ text: "Kova audio acceptance." })
            : new Response(new Uint8Array([73, 68, 51]), {
                headers: { "Content-Type": "audio/mpeg" },
              });
        },
      },
    );
    assert.equal(calls.length, 1);
    const form = calls[0].init.body;
    assert.equal(form.get("action"), action);
    assert.equal(form.get("audio").type, "audio/wav");
    assert.equal(form.get("audio").size, audio.size);
    assert.equal(form.get("voiceId"), action === "sts" ? "default" : null);
    if (action === "stt") assert.equal(result.text, "Kova audio acceptance.");
    else assert.equal(result.audio.size, 3);
  }
});
test("invalid inputs, empty transcripts and mismatched audio cannot be shown as success", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Error("must not dispatch");
  };
  for (const input of [
    { action: "tts", text: " ", voiceId: "default" },
    { action: "tts", text: "Some text", voiceId: 123 },
    { action: "sts", audio: new Blob(["not wav"], { type: "audio/wav" }), voiceId: "default" },
    { action: "stt", audio: new Blob(["wrong format"], { type: "audio/mp3" }) },
  ])
    await assert.rejects(submitVoiceTool({ ownerId: "owner-one", ...input }, { fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(
    submitVoiceTool(
      { ownerId: "owner-one", action: "stt", audio: wav() },
      { fetchImpl: async () => Response.json({ text: " " }) },
    ),
    /unreadable/,
  );
  await assert.rejects(
    submitVoiceTool(
      { ownerId: "owner-one", action: "tts", text: "Hello", voiceId: "default" },
      { fetchImpl: async () => Response.json({ not: "audio" }) },
    ),
    /unreadable/,
  );
  await assert.rejects(
    submitVoiceTool(
      { ownerId: "owner-one", action: "tts", text: "Hello", voiceId: "default" },
      { fetchImpl: async () => new Response(null, { headers: { "Content-Type": "audio/mpeg" } }) },
    ),
    /unreadable/,
  );
});
test("account changes and quota denials stay explicit and are never retried", async () => {
  const task = { ownerId: "owner-one", action: "tts", text: "Hello", voiceId: "default" };
  for (const [status, error, message] of [
    [409, "account_changed", /account changed/],
    [429, "quota_exceeded", /allowance/],
  ]) {
    let calls = 0;
    await assert.rejects(
      submitVoiceTool(task, {
        fetchImpl: async () => {
          calls++;
          return Response.json({ error }, { status });
        },
      }),
      message,
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    submitVoiceTool(task, {
      signal: controller.signal,
      fetchImpl: async () => {
        throw Error("must not dispatch");
      },
    }),
    /abort/i,
  );
});
