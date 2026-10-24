import test from "node:test";
import assert from "node:assert/strict";
import { executeVoice, voiceConfiguration } from "../../src/lib/voice/elevenlabs.server.mjs";
import { createVoiceHandler } from "../../src/lib/voice/handler.server.mjs";
import { encodeVoicePcm } from "../../src/lib/voice-pcm.mjs";

const vars = {
  KOVA_VOICE_ENABLED: "true",
  KOVA_VOICE_AUDIO_ENABLED: "true",
  KOVA_VOICE_DAILY_REQUEST_LIMIT: "20",
  ELEVENLABS_API_KEY: "synthetic-voice-test-credential",
  ELEVENLABS_VOICE_ID: "syntheticVoice",
};
const config = voiceConfiguration((key) => vars[key]);
const audio = new Blob([encodeVoicePcm([new Float32Array(1600)], 16000)], {
  type: "audio/wav",
});

test("TTS and voice conversion reject non-MP3 provider audio instead of relabeling it", async () => {
  for (const action of ["tts", "sts"]) {
    await assert.rejects(
      executeVoice({ action, text: "Synthetic fixture", audio }, config, {
        fetchImpl: async () =>
          new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/ogg" } }),
      }),
      /voice_invalid_response/,
    );
  }
});

test("MP3 response permits MIME parameters and preserves private no-store output", async () => {
  const response = await executeVoice({ action: "tts", text: "Synthetic fixture" }, config, {
    fetchImpl: async () =>
      new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "Audio/MPEG; charset=binary" },
      }),
  });
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

const outcome = async (operation) => {
  let timer;
  try {
    return await Promise.race([
      operation.then(
        () => "unexpected_success",
        (error) => error.message,
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("cancellation_cleanup_escaped_deadline"), 100);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

test("an upstream rejection cannot hang on never-settling response cancellation", async () => {
  const result = await outcome(
    executeVoice({ action: "tts", text: "Synthetic fixture" }, config, {
      timeoutMs: 10,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel: () => new Promise(() => {}),
          }),
          { status: 403 },
        ),
    }),
  );
  assert.equal(result, "voice_provider_unavailable");
});

test("oversized provider audio cannot hang on never-settling reader cancellation", async () => {
  const result = await outcome(
    executeVoice({ action: "tts", text: "Synthetic fixture" }, config, {
      timeoutMs: 10,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
            },
            cancel: () => new Promise(() => {}),
          }),
          { headers: { "Content-Type": "audio/mpeg" } },
        ),
    }),
  );
  assert.equal(result, "request_too_large");
});

const request = (signal) =>
  new Request("https://kova.invalid/api/voice", {
    method: "POST",
    headers: {
      Origin: "https://kova.invalid",
      "Content-Type": "application/json",
      "X-Kova-Voice-Owner": "synthetic-owner",
    },
    body: JSON.stringify({ action: "tts", text: "Synthetic fixture" }),
    signal,
  });

function fixture(overrides = {}) {
  let quota = 0;
  let provider = 0;
  const run = createVoiceHandler({
    requireUser: async () => ({ userId: "synthetic-owner", emailVerified: true }),
    assertNotBanned: async () => null,
    assertFeatureEnabled: async () => null,
    getCallerTier: async () => "free",
    env: (key) => vars[key],
    enforceQuota: async () => {
      quota++;
      await overrides.afterQuota?.();
      return null;
    },
    execute: async () => {
      provider++;
      await overrides.afterProvider?.();
      return new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    },
    ...overrides.dependencies,
  });
  return { run, counts: () => ({ quota, provider }) };
}

test("an already cancelled caller is rejected without quota or provider execution", async () => {
  const f = fixture();
  const response = await f.run(request(AbortSignal.abort()));
  assert.equal(response.status, 499);
  assert.deepEqual(await response.json(), { error: "voice_cancelled" });
  assert.deepEqual(f.counts(), { quota: 0, provider: 0 });
});

test("Stop during quota reservation prevents a later paid provider call", async () => {
  const controller = new AbortController();
  const f = fixture({ afterQuota: async () => controller.abort() });
  const response = await f.run(request(controller.signal));
  assert.equal(response.status, 499);
  assert.deepEqual(f.counts(), { quota: 1, provider: 0 });
});

test("Stop during late session revalidation discards the completed audio response", async () => {
  const controller = new AbortController();
  let cancelled = 0;
  let revalidation = 0;
  const f = fixture({
    dependencies: {
      requireUser: async () => ({
        userId: "synthetic-owner",
        emailVerified: true,
        revalidateSession: async () => {
          if (++revalidation === 2) controller.abort();
          return true;
        },
      }),
      execute: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { headers: { "Content-Type": "audio/mpeg" } },
        ),
    },
  });
  const response = await f.run(request(controller.signal));
  assert.equal(response.status, 499);
  assert.equal(cancelled, 1);
});

test("a session revoked during upload is rejected before quota and provider execution", async () => {
  const f = fixture({
    dependencies: {
      requireUser: async () => ({
        userId: "synthetic-owner",
        emailVerified: true,
        revalidateSession: async () => false,
      }),
    },
  });
  const response = await f.run(request());
  assert.equal(response.status, 401);
  assert.deepEqual(f.counts(), { quota: 0, provider: 0 });
});
