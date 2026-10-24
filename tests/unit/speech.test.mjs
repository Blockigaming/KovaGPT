import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createSpeechHandler,
  speechConfiguration,
  SPEECH_LIMITS,
} from "../../src/lib/speech.server.mjs";
import { createSpeechPlayback } from "../../src/lib/speech-playback.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const text = "A completed Kova response.";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const input = { ownerId: owner, chatId: "chat-1", messageId: "msg-1", contentSha256: digest(text) };
const request = (data = input, options = {}) =>
  new Request("https://kova.test/api/speech", {
    method: "POST",
    headers: { origin: "https://kova.test", "Content-Type": "application/json" },
    body: JSON.stringify(data),
    ...options,
  });
function fixture(overrides = {}) {
  const calls = { provider: [], limits: [], principal: 0, filters: [] };
  const row = {
    owner_id: owner,
    id: "chat-1",
    deleted_at: null,
    payload: { id: "chat-1", messages: [{ id: "msg-1", role: "assistant", content: text }] },
  };
  const chain = {
    select() {
      return this;
    },
    eq(...v) {
      calls.filters.push(v);
      return this;
    },
    is(...v) {
      calls.filters.push(v);
      return this;
    },
    abortSignal() {
      return this;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
  };
  const deps = {
    authenticate: async () => ({
      userId: owner,
      supabaseUser: {
        from(name) {
          assert.equal(name, "chat_history_records");
          return chain;
        },
      },
    }),
    rateLimit: async (bucket) => {
      calls.limits.push(bucket);
      return { allowed: true, status: "allowed", retryAfter: 1 };
    },
    revalidate: async () => {
      calls.principal++;
    },
    config: () => ({ enabled: true, apiKey: "mock-key-never-live", voiceId: "mockVoice" }),
    fetchImpl: async (...args) => {
      calls.provider.push(args);
      return new Response(new Uint8Array([73, 68, 51]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    },
    ...overrides,
  };
  return { handler: createSpeechHandler(deps), calls, row, deps };
}
test("owned stored assistant text streams once with server-only key and fail-closed distributed caps", async () => {
  const f = fixture();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51]);
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.principal, 2);
  assert.deepEqual(
    f.calls.limits.map((v) => [v.limit, v.windowSeconds]),
    [
      [3, 60],
      [20, 3600],
      [100, 3600],
    ],
  );
  assert.ok(f.calls.filters.some(([k, v]) => k === "owner_id" && v === owner));
  const [url, init] = f.calls.provider[0];
  assert.equal(
    url,
    "https://api.elevenlabs.io/v1/text-to-speech/mockVoice/stream?output_format=mp3_44100_128",
  );
  assert.equal(init.headers["xi-api-key"], "mock-key-never-live");
  assert.equal(JSON.parse(init.body).text, text);
  assert.equal(init.redirect, "error");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.doesNotMatch(JSON.stringify([...response.headers]), /mock-key/);
});

const catalog = [
  {
    id: "standard",
    label: "Fixture Standard",
    providerVoiceId: "fixtureStandardProvider",
    modelId: "eleven_flash_v2_5",
    allowedPlans: ["free", "plus", "pro"],
  },
  {
    id: "expressive",
    label: "Fixture Expressive",
    providerVoiceId: "fixtureExpressiveProvider",
    modelId: "eleven_v4",
    allowedPlans: ["plus", "pro"],
  },
];
function configuredSpeech(tier, overrides = {}) {
  const vars = {
    KOVA_SPEECH_ENABLED: "true",
    ELEVENLABS_API_KEY: "catalog-fixture-only",
    KOVA_VOICE_CATALOG: JSON.stringify(catalog),
    ...overrides,
  };
  return (_auth, requestInput) =>
    speechConfiguration((key) => vars[key], tier, requestInput.voiceId);
}

test("saved-response speech resolves the opaque selected voice and model from the catalog", async () => {
  let admission;
  const f = fixture({
    config: configuredSpeech("plus"),
    admit: async (value) => {
      admission = value;
      return null;
    },
  });
  const response = await f.handler(request({ ...input, voiceId: "expressive" }));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const [url, init] = f.calls.provider[0];
  assert.match(url, /\/fixtureExpressiveProvider\/stream\?/);
  assert.deepEqual(JSON.parse(init.body), { text, model_id: "eleven_v4" });
  assert.equal(admission.voiceId, "fixtureExpressiveProvider");
  assert.equal(admission.modelId, "eleven_v4");
});

test("catalog-only default voice works without a legacy provider voice binding", async () => {
  const f = fixture({
    config: configuredSpeech("plus", { KOVA_VOICE_DEFAULT_ID: "expressive" }),
  });
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.match(f.calls.provider[0][0], /\/fixtureExpressiveProvider\/stream\?/);
  assert.equal(JSON.parse(f.calls.provider[0][1].body).model_id, "eleven_v4");
});

test("legacy saved-response speech keeps its configured voice and multilingual model", async () => {
  const f = fixture({
    config: configuredSpeech("free", {
      KOVA_VOICE_CATALOG: undefined,
      ELEVENLABS_VOICE_ID: "legacyFixtureProvider",
    }),
  });
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.match(f.calls.provider[0][0], /\/legacyFixtureProvider\/stream\?/);
  assert.equal(JSON.parse(f.calls.provider[0][1].body).model_id, "eleven_multilingual_v2");
});

for (const [name, selected, overrides, code, status] of [
  ["locked", "expressive", {}, "speech_voice_plan_required", 403],
  ["unknown", "missing", {}, "speech_invalid_voice", 400],
  ["provider ID", "fixtureStandardProvider", {}, "speech_invalid_voice", 400],
  ["malformed", "../escape", {}, "speech_invalid_voice", 400],
  ["null", null, {}, "speech_invalid_voice", 400],
  [
    "invalid catalog",
    "standard",
    { KOVA_VOICE_CATALOG: "broken", ELEVENLABS_VOICE_ID: "noFallback" },
    "speech_not_configured",
    503,
  ],
  [
    "unsupported catalog model",
    "standard",
    { KOVA_VOICE_CATALOG: JSON.stringify([{ ...catalog[0], modelId: "unknown" }]) },
    "speech_not_configured",
    503,
  ],
])
  test(`${name} speech voice fails before quota and provider without fallback`, async () => {
    const f = fixture({ config: configuredSpeech("free", overrides) });
    const response = await f.handler(request({ ...input, voiceId: selected }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(f.calls.limits.length, 0);
    assert.equal(f.calls.provider.length, 0);
  });

test("caller cannot override the catalog provider/model on saved-response speech", async () => {
  const f = fixture({ config: configuredSpeech("plus") });
  const response = await f.handler(
    request({ ...input, voiceId: "expressive", modelId: "eleven_flash_v2_5" }),
  );
  assert.equal(response.status, 400);
  assert.equal(f.calls.limits.length, 0);
  assert.equal(f.calls.provider.length, 0);
});
for (const [name, overrides, data, status] of [
  ["anonymous", { authenticate: async () => new Response(null, { status: 401 }) }, input, 401],
  ["changed owner", {}, { ...input, ownerId: "other" }, 409],
  ["arbitrary browser text", {}, { ...input, text: "injected" }, 400],
  ["oversized request", {}, { ...input, padding: "x".repeat(1100) }, 413],
  ["unconfigured", { config: () => ({ enabled: true }) }, input, 503],
  [
    "disabled",
    { config: () => ({ enabled: false, apiKey: "mock", voiceId: "voice" }) },
    input,
    503,
  ],
  [
    "unsafe voice",
    { config: () => ({ enabled: true, apiKey: "mock", voiceId: "../other" }) },
    input,
    503,
  ],
  [
    "rate limited",
    { rateLimit: async () => ({ allowed: false, status: "limited", retryAfter: 15 }) },
    input,
    429,
  ],
  [
    "quota store outage",
    { rateLimit: async () => ({ allowed: false, status: "unavailable" }) },
    input,
    503,
  ],
  [
    "revoked principal",
    {
      revalidate: async () => {
        throw new Error("private diagnostic");
      },
    },
    input,
    503,
  ],
])
  test(`${name} never calls paid provider`, async () => {
    const f = fixture(overrides);
    const r = await f.handler(request(data));
    assert.equal(r.status, status);
    assert.equal(f.calls.provider.length, 0);
    assert.doesNotMatch(await r.text(), /private diagnostic|mock-key/);
  });
test("cross-site mutation rejected before authentication or provider", async () => {
  const f = fixture({
    authenticate: async () => {
      throw new Error("must not run");
    },
  });
  assert.equal(
    (await f.handler(request(input, { headers: { origin: "https://evil.test" } }))).status,
    403,
  );
});
for (const [name, mutate, status] of [
  ["another owner's row", (r) => (r.owner_id = "other"), 404],
  ["deleted chat", (r) => (r.deleted_at = "now"), 404],
  ["temporary chat", (r) => (r.payload.temporary = true), 404],
  ["user message", (r) => (r.payload.messages[0].role = "user"), 404],
  ["stopped response", (r) => (r.payload.messages[0].generationStatus = "stopped"), 404],
  ["failed response", (r) => (r.payload.messages[0].generationStatus = "failed"), 404],
  ["empty response", (r) => (r.payload.messages[0].content = " "), 404],
  ["pending image", (r) => (r.payload.messages[0].pendingImage = true), 404],
  ["duplicate message ID", (r) => r.payload.messages.push(r.payload.messages[0]), 404],
  ["stale local response", (r) => (r.payload.messages[0].content = "different saved content"), 409],
  ["overlong response", (r) => (r.payload.messages[0].content = "x".repeat(4001)), 413],
])
  test(`${name} is denied before provider`, async () => {
    const f = fixture();
    mutate(f.row);
    assert.equal((await f.handler(request())).status, status);
    assert.equal(f.calls.provider.length, 0);
  });
test("unsaved message has no local text fallback", async () => {
  const f = fixture();
  f.row.payload.messages = [];
  assert.equal((await f.handler(request())).status, 404);
  assert.equal(f.calls.provider.length, 0);
});
test("provider error body stays private and is never retried", async () => {
  let calls = 0;
  const f = fixture({
    fetchImpl: async () => {
      calls++;
      return new Response("secret provider detail", { status: 401 });
    },
  });
  const r = await f.handler(request());
  assert.equal(r.status, 502);
  assert.equal(calls, 1);
  assert.doesNotMatch(await r.text(), /secret provider detail|mock-key/);
});
test("empty audio is a clear failure before 200", async () => {
  const f = fixture({
    fetchImpl: async () =>
      new Response(new Uint8Array(), { headers: { "Content-Type": "audio/mpeg" } }),
  });
  const r = await f.handler(request());
  assert.equal(r.status, 502);
  assert.match(await r.text(), /speech_empty_audio/);
});
test("speech accepts case-insensitive MP3 MIME with parameters without relabeling codecs", async () => {
  for (const [contentType, status] of [
    ["Audio/MPEG; charset=binary", 200],
    ["audio/ogg", 502],
  ]) {
    const f = fixture({
      fetchImpl: async () =>
        new Response(new Uint8Array([1]), { headers: { "Content-Type": contentType } }),
    });
    const response = await f.handler(request());
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
});
test("audio is streamed before upstream completion and cancellation aborts provider", async () => {
  let signal,
    canceled = false;
  const f = fixture({
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "Content-Type": "audio/mpeg" } },
      );
    },
  });
  const response = await f.handler(request());
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1]);
  await reader.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(canceled, true);
});
test("oversized provider stream fails without buffering all audio", async () => {
  const f = fixture({
    fetchImpl: async () =>
      new Response(new Uint8Array(SPEECH_LIMITS.audioBytes + 1), {
        headers: { "Content-Type": "audio/mpeg" },
      }),
  });
  const r = await f.handler(request());
  await assert.rejects(r.arrayBuffer(), /speech_stream_interrupted/);
});
function client(fetchImpl) {
  const states = [],
    chunks = [];
  let sinkOptions,
    disposed = 0;
  const player = createSpeechPlayback({
    fetchImpl,
    onState: (...v) => states.push(v),
    createSink: (options) => {
      sinkOptions = options;
      return {
        async write(v) {
          chunks.push(...v);
          options.onPlaying();
        },
        async end() {},
        dispose() {
          disposed++;
        },
      };
    },
  });
  return { player, states, chunks, end: () => sinkOptions.onEnded(), disposed: () => disposed };
}
test("playback exposes loading/playing/completion and sends IDs, never raw text", async () => {
  const f = client(async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), input);
    return new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } });
  });
  await f.player.start(input);
  assert.deepEqual(f.chunks, [1, 2]);
  assert.ok(f.states.some(([s]) => s === "loading"));
  assert.ok(f.states.some(([s]) => s === "playing"));
  f.end();
  assert.equal(f.states.at(-1)[0], "idle");
  assert.equal(f.disposed(), 1);
});
test("Stop during loading ignores late response and disposes audio", async () => {
  let resolve, signal;
  const f = client((_url, init) => {
    signal = init.signal;
    return new Promise((r) => (resolve = r));
  });
  const pending = f.player.start(input);
  f.player.stop();
  resolve(new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } }));
  await pending;
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.chunks, []);
  assert.equal(f.states.at(-1)[0], "idle");
});
test("Stop during stream cancels pending read and prevents stale playing callback", async () => {
  let canceled = false;
  const f = client(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "Content-Type": "audio/mpeg" } },
      ),
  );
  const pending = f.player.start(input);
  await new Promise((r) => setImmediate(r));
  f.player.stop();
  await pending;
  assert.equal(canceled, true);
  assert.equal(f.states.at(-1)[0], "idle");
});
test("new response playback stops previous response", async () => {
  const audio = async () =>
    new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } });
  const a = client(audio),
    b = client(audio);
  await a.player.start(input);
  await b.player.start(input);
  assert.equal(a.disposed(), 1);
  assert.equal(a.states.at(-1)[0], "idle");
  b.player.stop();
});
test("provider/network playback error is clear and never automatically retried", async () => {
  let calls = 0;
  const f = client(async () => {
    calls++;
    throw new Error("private detail");
  });
  await f.player.start(input);
  assert.equal(calls, 1);
  assert.deepEqual(f.states.at(-1), ["error", "speech_unavailable"]);
});

test("server deadline bounds stalled authentication without provider work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ authenticate: () => new Promise(() => {}) });
  const pending = f.handler(request());
  t.mock.timers.tick(60001);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.equal(f.calls.provider.length, 0);
});

test("client request timeout stops loading and never retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve, signal;
  const f = client((_url, init) => {
    signal = init.signal;
    return new Promise((r) => (resolve = r));
  });
  const pending = f.player.start(input);
  t.mock.timers.tick(60001);
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.states.at(-1), ["error", "speech_timeout"]);
  resolve(new Response(null, { status: 503 }));
  await pending;
  assert.deepEqual(f.states.at(-1), ["error", "speech_timeout"]);
});

test("abort while reading a stalled request body releases it", async () => {
  let canceled = false;
  const controller = new AbortController();
  const f = fixture();
  const req = request(input, {
    body: new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    duplex: "half",
    signal: controller.signal,
  });
  const pending = f.handler(req);
  await new Promise((r) => setImmediate(r));
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal(canceled, true);
  assert.equal(f.calls.provider.length, 0);
});

test("principal revocation after slow first audio byte prevents exposure", async () => {
  let checks = 0;
  const f = fixture({
    revalidate: async () => {
      if (++checks === 2) throw new Error("revoked");
    },
  });
  const response = await f.handler(request());
  assert.equal(response.status, 503);
  assert.equal(f.calls.provider.length, 1);
  assert.doesNotMatch(await response.text(), /revoked/);
});

test("request disconnect after headers aborts provider stream", async () => {
  const controller = new AbortController();
  let signal;
  const f = fixture({
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
        }),
        { headers: { "Content-Type": "audio/mpeg" } },
      );
    },
  });
  const response = await f.handler(request(input, { signal: controller.signal }));
  controller.abort();
  await assert.rejects(response.arrayBuffer());
  assert.equal(signal.aborted, true);
});

test("Stop discards queued audio before the next downstream read", async () => {
  const controller = new AbortController();
  let canceled = false;
  const f = fixture({
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "Content-Type": "audio/mpeg" } },
      ),
  });
  const response = await f.handler(request(input, { signal: controller.signal }));
  controller.abort();
  await assert.rejects(response.body.getReader().read(), /speech_stream_interrupted/);
  assert.equal(canceled, true);
});
