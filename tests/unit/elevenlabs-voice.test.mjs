import test from "node:test";
import { encodeVoicePcm } from "../../src/lib/voice-pcm.mjs";
import assert from "node:assert/strict";
import { createVoiceHandler } from "../../src/lib/voice/handler.server.mjs";
import { readFile } from "node:fs/promises";
import {
  voiceConfiguration,
  publicVoiceConfiguration,
  parseVoiceRequest,
  executeVoice,
  voiceErrorResponse,
  MAX_AUDIO_BYTES,
} from "../../src/lib/voice/elevenlabs.server.mjs";
const env = {
  KOVA_VOICE_ENABLED: "true",
  KOVA_VOICE_AUDIO_ENABLED: "true",
  KOVA_SPEECH_ENABLED: "true",
  ELEVENLABS_API_KEY: "fixture-only-not-a-real-key",
  ELEVENLABS_VOICE_ID: "fixtureVoice",
  KOVA_VOICE_DAILY_REQUEST_LIMIT: "3",
};
const config = voiceConfiguration((k) => env[k]);
const audio = new Blob([encodeVoicePcm([new Float32Array(16000)], 16000)], { type: "audio/wav" });
const multipart = (action = "stt", blob = audio) => {
  const form = new FormData();
  form.set("action", action);
  form.set("audio", blob, "input.webm");
  return new Request("https://kova.invalid/api/voice", { method: "POST", body: form });
};
const json = (body) =>
  new Request("https://kova.invalid/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("configuration fails closed and public status never includes credential or voice ID", () => {
  assert.deepEqual(publicVoiceConfiguration(config), {
    configured: true,
    stt: true,
    tts: true,
    sts: true,
    conversation: true,
    voices: [{ id: "default", label: "Default voice", available: true }],
    defaultVoiceId: "default",
  });
  for (const key of ["KOVA_VOICE_ENABLED", "ELEVENLABS_API_KEY", "KOVA_VOICE_DAILY_REQUEST_LIMIT"])
    assert.equal(voiceConfiguration((k) => (k === key ? undefined : env[k])).configured, false);
  for (const limit of ["0", "-1", "NaN", "1.5", "Infinity"])
    assert.equal(
      voiceConfiguration((k) => (k === "KOVA_VOICE_DAILY_REQUEST_LIMIT" ? limit : env[k]))
        .configured,
      false,
    );
  assert.equal(
    voiceConfiguration((k) => (k === "ELEVENLABS_VOICE_ID" ? undefined : env[k])).tts,
    false,
  );
  const noAudio = voiceConfiguration((k) =>
    k === "KOVA_VOICE_AUDIO_ENABLED" ? undefined : env[k],
  );
  assert.equal(noAudio.stt, false);
  assert.equal(noAudio.sts, false);
  assert.equal(noAudio.tts, true);
  assert.equal(noAudio.conversation, false);
  assert.equal(
    voiceConfiguration((k) => (k === "ELEVENLABS_VOICE_ID" ? "../escape" : env[k])).sts,
    false,
  );
});
test("conversation capability requires both input and caller-eligible saved-speech output", () => {
  const read = (extra = {}, tier = "free") =>
    publicVoiceConfiguration(voiceConfiguration((key) => ({ ...env, ...extra })[key], tier));
  const withoutSpeech = read({ KOVA_SPEECH_ENABLED: undefined });
  assert.equal(withoutSpeech.stt, true);
  assert.equal(withoutSpeech.tts, true);
  assert.equal(withoutSpeech.conversation, false);
  assert.equal(read({ KOVA_SPEECH_ENABLED: "false" }).conversation, false);
  const lockedOnly = {
    KOVA_VOICE_CATALOG: JSON.stringify([
      {
        id: "locked",
        label: "Fixture Locked",
        providerVoiceId: "fixtureLockedVoice",
        allowedPlans: ["pro"],
        showWhenLocked: true,
      },
    ]),
  };
  const free = read(lockedOnly);
  assert.equal(free.configured, true);
  assert.equal(free.stt, true);
  assert.equal(free.tts, false);
  assert.equal(free.conversation, false);
  assert.equal(read(lockedOnly, "pro").conversation, true);
  assert.equal(read({ ELEVENLABS_VOICE_ID: undefined }).conversation, false);
  for (const extra of [
    { KOVA_GENERATION_DISABLED: "true" },
    { KOVA_REQUEST_CAPTURE_ENABLED: "true" },
    { KOVA_GENERATION_ACCEPTANCE_ENABLED: "true" },
    { KOVA_VOICE_ENABLED: "false" },
    { ELEVENLABS_API_KEY: undefined },
    { KOVA_VOICE_DAILY_REQUEST_LIMIT: "0" },
  ])
    assert.equal(read(extra).conversation, false);
});
test("JSON only permits bounded nonempty TTS text", async () => {
  assert.deepEqual(await parseVoiceRequest(json({ action: "tts", text: " hello " })), {
    action: "tts",
    text: "hello",
  });
  for (const body of [
    null,
    {},
    { action: "sts", text: "a" },
    { action: "tts", text: " " },
    { action: "tts", text: 3 },
  ])
    await assert.rejects(parseVoiceRequest(json(body)), /invalid_text/);
  await assert.rejects(
    parseVoiceRequest(json({ action: "tts", text: "x".repeat(5001) })),
    /request_too_large/,
  );
});
test("multipart accepts normalized PCM WAV and rejects spoofed audio, unknown action, oversize", async () => {
  assert.equal((await parseVoiceRequest(multipart())).action, "stt");
  assert.equal((await parseVoiceRequest(multipart("sts"))).action, "sts");
  await assert.rejects(
    parseVoiceRequest(multipart("stt", new Blob(["fake"], { type: "audio/webm" }))),
    /invalid_audio/,
  );
  await assert.rejects(parseVoiceRequest(multipart("other")), /invalid_audio/);
  await assert.rejects(
    parseVoiceRequest(
      multipart("stt", new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/webm" })),
    ),
    /request_too_large/,
  );
});
test("TTS sends only server-selected model/voice and returns uncached audio", async () => {
  let calls = 0;
  const result = await executeVoice({ action: "tts", text: "hello" }, config, {
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(
        url,
        "https://api.elevenlabs.io/v1/text-to-speech/fixtureVoice?output_format=mp3_44100_128",
      );
      assert.equal(init.headers["xi-api-key"], env.ELEVENLABS_API_KEY);
      assert.equal(init.redirect, "error");
      assert.deepEqual(JSON.parse(init.body), {
        text: "hello",
        model_id: "eleven_multilingual_v2",
      });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(result.headers.get("Content-Type"), "audio/mpeg");
});
test("STT uses file and scribe_v2; STS uses audio and voice changer model", async () => {
  for (const action of ["stt", "sts"]) {
    const result = await executeVoice({ action, audio }, config, {
      fetchImpl: async (url, init) => {
        assert.equal(
          init.body.get("model_id"),
          action === "stt" ? "scribe_v2" : "eleven_multilingual_sts_v2",
        );
        assert.ok(init.body.get(action === "stt" ? "file" : "audio") instanceof Blob);
        assert.equal(init.headers["Content-Type"], undefined);
        assert.ok(
          url.includes(action === "stt" ? "/speech-to-text" : "/speech-to-speech/fixtureVoice"),
        );
        return action === "stt"
          ? Response.json({ text: "fixture transcript", words: [], secret: "omit" })
          : new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } });
      },
    });
    if (action === "stt") assert.deepEqual(await result.json(), { text: "fixture transcript" });
  }
});
test("disabled provider and cancelled caller do not invoke fetch", async () => {
  const fetchImpl = async () => {
    throw new Error("must not call");
  };
  await assert.rejects(
    executeVoice({ action: "tts", text: "hello" }, { ...config, tts: false }, { fetchImpl }),
    /voice_not_configured/,
  );
  await assert.rejects(
    executeVoice({ action: "tts", text: "hello" }, config, {
      fetchImpl,
      signal: AbortSignal.abort(),
    }),
    /voice_cancelled/,
  );
});
test("upstream error body/credentials never leak and no automatic paid retry occurs", async () => {
  let calls = 0;
  try {
    await executeVoice({ action: "tts", text: "hello" }, config, {
      fetchImpl: async () => {
        calls++;
        return new Response("sensitive upstream body", { status: 401 });
      },
    });
  } catch (error) {
    assert.deepEqual(await voiceErrorResponse(error).json(), {
      error: "voice_provider_unavailable",
    });
  }
  assert.equal(calls, 1);
});
test("timeout stays active while reading response body", async () => {
  await assert.rejects(
    executeVoice({ action: "tts", text: "hello" }, config, {
      timeoutMs: 5,
      fetchImpl: async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { "Content-Type": "audio/mpeg" },
        }),
    }),
    /voice_timeout/,
  );
});
test("malformed provider payload rejected", async () => {
  await assert.rejects(
    executeVoice({ action: "stt", audio }, config, {
      fetchImpl: async () => Response.json({ words: [] }),
    }),
    /voice_invalid_response/,
  );
  await assert.rejects(
    executeVoice({ action: "tts", text: "hello" }, config, {
      fetchImpl: async () => Response.json({ error: "oops" }),
    }),
    /voice_invalid_response/,
  );
});
test("route source enforces auth, verification, maintenance and atomic quota before transport", async () => {
  const source = await readFile(
    new URL("../../src/lib/voice/handler.server.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireUser\(request\)/);
  assert.match(source, /!auth.emailVerified/);
  assert.match(source, /assertNotBanned\(auth\)/);
  assert.match(source, /assertFeatureEnabled\(auth, ['"]voice['"]\)/);
  assert.ok(source.indexOf('enforceQuota(auth, "voice"') < source.indexOf("await execute("));
  assert.match(source, /auth.revalidateSession/);
});

const caller = { userId: "fixture-owner", emailVerified: true };
function handler(overrides = {}) {
  const events = [];
  const deps = {
    requireUser: async () => {
      events.push("auth");
      return caller;
    },
    assertNotBanned: async () => {
      events.push("ban");
      return null;
    },
    assertFeatureEnabled: async () => {
      events.push("feature");
      return null;
    },
    enforceQuota: async (_auth, kind, limit, increment) => {
      events.push("quota");
      assert.equal(kind, "voice");
      assert.equal(limit, 3);
      assert.equal(increment, 1);
      return null;
    },
    getCallerTier: async () => "free",
    env: (k) => env[k],
    execute: async () => {
      events.push("provider");
      return Response.json({ ok: true });
    },
    ...overrides,
  };
  return { run: createVoiceHandler(deps), events };
}
function authenticatedRequest(options = {}) {
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://kova.invalid",
    "X-Kova-Voice-Owner": "fixture-owner",
    ...options.headers,
  };
  return new Request("https://kova.invalid/api/voice", {
    method: "POST",
    body: JSON.stringify({ action: "tts", text: "hello" }),
    ...options,
    headers,
  });
}
test("handler performs ordered auth/ban/feature/quota before provider", async () => {
  const { run, events } = handler();
  assert.equal((await run(authenticatedRequest())).status, 200);
  assert.deepEqual(events, ["auth", "ban", "feature", "quota", "provider"]);
});
test("global kill and qualification modes deny voice before quota or provider", async () => {
  for (const blocked of [
    { KOVA_GENERATION_DISABLED: "true" },
    { KOVA_REQUEST_CAPTURE_ENABLED: "true" },
    { KOVA_REQUEST_CAPTURE_ENABLED: "invalid-nonfalse-value" },
    { KOVA_GENERATION_ACCEPTANCE_ENABLED: "true" },
    { KOVA_GENERATION_ACCEPTANCE_ENABLED: "invalid-nonfalse-value" },
  ]) {
    const configuredEnv = { ...env, ...blocked };
    const getEnv = (key) => configuredEnv[key];
    const configuration = voiceConfiguration(getEnv);
    assert.equal(configuration.configured, false);
    assert.equal(configuration.stt, false);
    assert.equal(configuration.tts, false);
    assert.equal(configuration.sts, false);
    const { run, events } = handler({ env: getEnv });
    const response = await run(authenticatedRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "voice_not_configured" });
    assert.deepEqual(events, ["auth", "ban", "feature"]);
  }
});
test("explicitly disabled qualification flags preserve ordinary voice quota and execution", async () => {
  const configuredEnv = {
    ...env,
    KOVA_GENERATION_DISABLED: "false",
    KOVA_REQUEST_CAPTURE_ENABLED: "false",
    KOVA_GENERATION_ACCEPTANCE_ENABLED: "false",
  };
  const { run, events } = handler({ env: (key) => configuredEnv[key] });
  assert.equal((await run(authenticatedRequest())).status, 200);
  assert.deepEqual(events, ["auth", "ban", "feature", "quota", "provider"]);
});
test("account mismatch, unverified, banned, quota exhausted and disabled configuration never call provider", async () => {
  for (const [overrides, req, status] of [
    [{}, authenticatedRequest({ headers: { "X-Kova-Voice-Owner": "other" } }), 409],
    [
      { requireUser: async () => ({ ...caller, emailVerified: false }) },
      authenticatedRequest(),
      403,
    ],
    [{ requireUser: async () => new Response(null, { status: 401 }) }, authenticatedRequest(), 401],
    [
      { assertNotBanned: async () => new Response(null, { status: 403 }) },
      authenticatedRequest(),
      403,
    ],
    [
      { assertFeatureEnabled: async () => new Response(null, { status: 503 }) },
      authenticatedRequest(),
      503,
    ],
    [
      { enforceQuota: async () => new Response(null, { status: 429 }) },
      authenticatedRequest(),
      429,
    ],
    [{ env: () => undefined }, authenticatedRequest(), 503],
  ]) {
    const { run, events } = handler(overrides);
    assert.equal((await run(req)).status, status);
    assert.ok(!events.includes("provider"));
  }
});
test("cross-site requests rejected before auth/quota", async () => {
  const { run, events } = handler();
  assert.equal(
    (await run(authenticatedRequest({ headers: { Origin: "https://evil.invalid" } }))).status,
    403,
  );
  assert.deepEqual(events, []);
});
test("GET capability probe does not consume quota or call provider", async () => {
  const { run, events } = handler({ env: () => undefined });
  const result = await run(
    new Request("https://kova.invalid/api/voice", {
      headers: { "X-Kova-Voice-Owner": "fixture-owner" },
    }),
  );
  assert.deepEqual(await result.json(), {
    configured: false,
    stt: false,
    tts: false,
    sts: false,
    conversation: false,
    voices: [],
    defaultVoiceId: null,
  });
  assert.ok(!events.includes("quota"));
  assert.ok(!events.includes("provider"));
});
test("session revocation after provider withholds response", async () => {
  let revalidation = 0;
  const { run, events } = handler({
    requireUser: async () => ({
      ...caller,
      revalidateSession: async () => ++revalidation === 1,
    }),
  });
  assert.equal((await run(authenticatedRequest())).status, 401);
  assert.equal(revalidation, 2);
  assert.ok(events.includes("provider"));
});
test("all configured REST speech models use server-only selection; invalid model never fetches", async () => {
  for (const modelId of ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_v4"]) {
    await executeVoice(
      { action: "tts", text: "fixture" },
      { ...config, modelId },
      {
        fetchImpl: async (url, init) => {
          assert.ok(url.includes("/v1/text-to-speech/fixtureVoice"));
          assert.equal(JSON.parse(init.body).model_id, modelId);
          return new Response(new Uint8Array([1, 2]), {
            headers: { "Content-Type": "audio/mpeg" },
          });
        },
      },
    );
  }
  await assert.rejects(
    executeVoice(
      { action: "tts", text: "fixture" },
      { ...config, modelId: "evil" },
      {
        fetchImpl: async () => {
          throw new Error("must not fetch");
        },
      },
    ),
    /voice_not_configured/,
  );
});
