import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSpeechHandler } from "../../src/lib/speech.server.mjs";
import {
  issueVoiceModelReceipt,
  issueVoiceSegmentReceipt,
  verifyVoiceModelReceipt,
  verifyVoiceSegmentReceipt,
  voiceModelPolicy,
} from "../../src/lib/voice/openai-model-eligibility.server.mjs";
import { relayEligibleVoiceChat } from "../../src/lib/voice/chat-model-receipt.server.mjs";
import { createSpeechSegmenter, speakableText } from "../../src/lib/voice/speech-segmenter.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const policy = voiceModelPolicy(
  (key) =>
    ({
      KOVA_VOICE_OPENAI_MODELS_JSON: '["fixture-openai-model"]',
      KOVA_VOICE_MODEL_PROOF_SECRET: "fixture-only-signing-key-with-enough-bytes",
    })[key],
);
const identity = {
  ownerId: owner,
  chatId: "chat-1",
  messageId: "msg-1",
  provider: "openai",
  modelId: "fixture-openai-model",
};
const digest = (v) => createHash("sha256").update(v).digest("hex");
const segmentBody = (index, text, overrides = {}) => ({
  ownerId: owner,
  chatId: "chat-1",
  messageId: "msg-1",
  mode: "live-segment",
  segmentIndex: index,
  text,
  contentSha256: digest(text),
  segmentReceipt: issueVoiceSegmentReceipt(policy, { ...identity, index, text }),
  ...overrides,
});
const post = (body) =>
  new Request("https://kova.test/api/speech", {
    method: "POST",
    headers: { origin: "https://kova.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function fixture(overrides = {}) {
  const calls = { provider: [], limits: [], quota: 0, principal: 0 };
  const handler = createSpeechHandler({
    authenticate: async () => ({ userId: owner }),
    rateLimit: async (bucket) => {
      calls.limits.push(bucket);
      return { allowed: true, status: "allowed", retryAfter: 1 };
    },
    revalidate: async () => {
      calls.principal++;
    },
    quota: async () => {
      calls.quota++;
      return null;
    },
    config: () => ({ enabled: true, apiKey: "mock-key-never-live", voiceId: "mockVoice" }),
    modelPolicy: () => policy,
    fetchImpl: async (...args) => {
      calls.provider.push(args);
      return new Response(new Uint8Array([73, 68, 51]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    },
    ...overrides,
  });
  return { handler, calls };
}

test("segmenter starts early at a clause, keeps punctuation, and avoids false sentence ends", () => {
  const s = createSpeechSegmenter();
  const out = [];
  const text =
    "Sure, here is the plan. First, we check the cache, then we measure latency. Dr. Smith said 3.5 seconds is fine! Ok.";
  for (const ch of text) out.push(...s.push(ch));
  out.push(...s.flush());
  assert.equal(out[0], "Sure, here is the plan.");
  assert.ok(out.join(" ").includes("Dr. Smith said 3.5 seconds is fine!"));
  assert.equal(out.join(" "), text);
});

test("segmenter never speaks markup or splits inside an unfinished code fence", () => {
  assert.equal(speakableText("## **Hi** [link](http://x.y) `code`"), "Hi link code");
  const s = createSpeechSegmenter();
  const out = [...s.push("Here you go. ```js\nconst a = 1. 2. 3.\n"), ...s.push("```\nDone now.")];
  out.push(...s.flush());
  assert.ok(out.every((part) => !part.includes("const")));
});

test("segment receipts bind owner, chat, reply, index and exact text and are not whole-reply receipts", () => {
  const text = "Hello there, friend.";
  const receipt = issueVoiceSegmentReceipt(policy, { ...identity, index: 0, text });
  const base = { ownerId: owner, chatId: "chat-1", messageId: "msg-1", index: 0, text };
  assert.deepEqual(verifyVoiceSegmentReceipt(policy, receipt, base), {
    provider: "openai",
    modelId: "fixture-openai-model",
  });
  for (const change of [
    { text: "Hello there, friends." },
    { index: 1 },
    { messageId: "msg-2" },
    { chatId: "chat-2" },
    { ownerId: "22222222-2222-4222-8222-222222222222" },
  ])
    assert.equal(verifyVoiceSegmentReceipt(policy, receipt, { ...base, ...change }), null);
  const whole = issueVoiceModelReceipt(policy, { ...identity, content: text });
  assert.equal(verifyVoiceSegmentReceipt(policy, whole, base), null);
  assert.equal(verifyVoiceModelReceipt(policy, receipt, { ...base, content: text }), null);
  assert.equal(
    issueVoiceSegmentReceipt(policy, { ...identity, modelId: "unlisted", index: 0, text }),
    null,
  );
});

test("relay emits signed segments before the stream ends and still issues the whole-reply receipt last", async () => {
  const events = [
    "Sure, here is the plan. ",
    "First, we check the cache. ",
    "Then we measure.",
  ].map((content) => ({ choices: [{ delta: { content } }] }));
  events.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
  const body = new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));
      c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  const frames = [];
  const receipt = await relayEligibleVoiceChat(body, {
    policy,
    identity,
    emit: (f) => frames.push(JSON.parse(f.replace(/^data: /u, ""))),
  });
  const segments = frames
    .map((f) => f.choices?.[0]?.delta)
    .filter((delta) => delta?.kind === "voice_segment");
  assert.ok(segments.length >= 2);
  assert.deepEqual(
    segments.map((s) => s.index),
    segments.map((_, i) => i),
  );
  for (const seg of segments)
    assert.ok(
      verifyVoiceSegmentReceipt(policy, seg.receipt, {
        ownerId: owner,
        chatId: "chat-1",
        messageId: "msg-1",
        index: seg.index,
        text: seg.text,
      }),
    );
  assert.equal(
    verifyVoiceModelReceipt(policy, receipt, {
      ownerId: owner,
      chatId: "chat-1",
      messageId: "msg-1",
      content: "Sure, here is the plan. First, we check the cache. Then we measure.",
    })?.modelId,
    "fixture-openai-model",
  );
});

test("a spoken reply charges plan quota and provider buckets once, even with parallel segments", async () => {
  const f = fixture();
  const responses = await Promise.all([
    f.handler(post(segmentBody(0, "Sure, here is the plan."))),
    f.handler(post(segmentBody(1, "First, we check the cache."))),
    f.handler(post(segmentBody(2, "Then we measure."))),
  ]);
  for (const r of responses) {
    assert.equal(r.status, 200);
    await r.arrayBuffer();
  }
  assert.equal(f.calls.quota, 1);
  assert.equal(f.calls.limits.length, 3);
  assert.equal(f.calls.provider.length, 3);
  const bodies = f.calls.provider.map(([, init]) => JSON.parse(init.body));
  assert.ok(bodies.every((b) => b.model_id === "eleven_flash_v2_5"));
  assert.ok(bodies.some((b) => b.previous_text === "Sure, here is the plan."));
});

test("a different reply is a new quota charge and stream model is configurable but allowlisted", async () => {
  const f = fixture({ streamModelId: "eleven_v4_turbo" });
  const a = await f.handler(post(segmentBody(0, "One.")));
  await a.arrayBuffer();
  const other = segmentBody(0, "Two.", {
    messageId: "msg-2",
    segmentReceipt: issueVoiceSegmentReceipt(policy, {
      ...identity,
      messageId: "msg-2",
      index: 0,
      text: "Two.",
    }),
  });
  const b = await f.handler(post(other));
  await b.arrayBuffer();
  assert.equal(f.calls.quota, 2);
  assert.equal(JSON.parse(f.calls.provider[0][1].body).model_id, "eleven_v4_turbo");
});

test("tampered text, replayed segments, forged receipts and an exhausted quota never reach the provider", async () => {
  const f = fixture();
  const good = segmentBody(0, "Sure, here is the plan.");
  const tampered = await f.handler(
    post({ ...good, text: "Something else.", contentSha256: digest("Something else.") }),
  );
  assert.equal(tampered.status, 403);
  const forged = await f.handler(post({ ...good, segmentReceipt: "abc.def" }));
  assert.equal(forged.status, 403);
  const ok = await f.handler(post(good));
  assert.equal(ok.status, 200);
  await ok.arrayBuffer();
  const replay = await f.handler(post(good));
  assert.equal(replay.status, 409);
  assert.equal(f.calls.provider.length, 1);

  const denied = fixture({
    quota: async () =>
      Response.json({ error: "message_window_limit" }, { status: 429, headers: {} }),
  });
  const r = await denied.handler(post(segmentBody(0, "Hi there.")));
  assert.equal(r.status, 429);
  assert.equal(denied.calls.provider.length, 0);
  const retry = await denied.handler(post(segmentBody(0, "Hi there.")));
  assert.equal(retry.status, 429);
});

test("segment limits cap index, length and total characters per reply", async () => {
  const f = fixture();
  assert.equal((await f.handler(post(segmentBody(99, "Hi."), {}))).status, 400);
  const long = "a".repeat(1001);
  assert.equal((await f.handler(post(segmentBody(0, long)))).status, 400);
});

test("short complete opening sentences can reach synthesis before the remaining reply", () => {
  const s = createSpeechSegmenter();
  assert.deepEqual(s.push("Of course! "), ["Of course!"]);
  assert.deepEqual(s.push("Here are the details."), []);
  assert.deepEqual(s.flush(), ["Here are the details."]);
});

test("early sentence segmentation does not cut a short opening clause or decimal", () => {
  const s = createSpeechSegmenter();
  assert.deepEqual(s.push("Sure, "), []);
  assert.deepEqual(s.push("the value is 3."), []);
  assert.deepEqual(s.push("5 volts. "), ["Sure, the value is 3.5 volts."]);
  assert.deepEqual(s.flush(), []);
});

test("signed live segments negotiate 24 kHz PCM without changing the selected ElevenLabs voice", async () => {
  const f = fixture({
    fetchImpl: async (url, init) => {
      assert.match(url, /\/mockVoice\/stream\?output_format=pcm_24000$/u);
      assert.equal(init.headers.Accept, "audio/pcm");
      assert.equal(JSON.parse(init.body).model_id, "eleven_flash_v2_5");
      return new Response(new Uint8Array([0, 0, 1, 0]), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
  });
  const request = new Request("https://kova.test/api/speech", {
    method: "POST",
    headers: {
      origin: "https://kova.test",
      "Content-Type": "application/json",
      Accept: "audio/pcm",
    },
    body: JSON.stringify(segmentBody(0, "Hello there.")),
  });
  const response = await f.handler(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/pcm; rate=24000");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 0, 1, 0]));
  assert.equal(f.calls.quota, 1);
});
