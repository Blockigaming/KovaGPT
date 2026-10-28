import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechPlayback } from "../../src/lib/speech-playback.mjs";

const input = () => ({
  ownerId: "owner-a",
  chatId: "chat-a",
  messageId: "assistant-a",
  contentSha256: "a".repeat(64),
});
const audio = () =>
  new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } });

function fixture(options = {}) {
  const sinks = [],
    states = [],
    completed = [];
  const player = createSpeechPlayback({
    fetchImpl: options.fetchImpl ?? (async () => audio()),
    onState: (...state) => {
      states.push(state);
      options.onState?.(...state);
    },
    onEnded: (value) => completed.push(value),
    createSink: (callbacks) => {
      const sink = { callbacks, disposed: 0 };
      sinks.push(sink);
      return {
        async write() {
          callbacks.onPlaying();
        },
        async end() {},
        dispose() {
          sink.disposed++;
        },
      };
    },
  });
  return { player, sinks, states, completed };
}

test("completion waits for natural audio-ended, not fetched bytes, and binds exact request scope", async () => {
  let body;
  const f = fixture({
    fetchImpl: async (_url, request) => {
      body = JSON.parse(request.body);
      return audio();
    },
  });
  const request = { ...input(), voiceId: "warm" };
  try {
    await f.player.start(request);
    request.ownerId = "owner-b";
    request.chatId = "chat-b";
    request.voiceId = "default";
    assert.equal(body.voiceId, "warm", "Playback sends the selected opaque catalog ID");
    assert.deepEqual(f.completed, []);
    f.sinks[0].callbacks.onEnded();
    assert.deepEqual(f.completed, [body]);
    assert.equal(Object.isFrozen(f.completed[0]), true);
    assert.deepEqual(f.states.at(-1), ["idle"]);
    assert.equal(f.sinks[0].disposed, 1);
    f.sinks[0].callbacks.onEnded();
    assert.equal(f.completed.length, 1);
  } finally {
    f.player.stop();
  }
});

test("Stop and a late response/audio-ended never report natural completion", async () => {
  let release;
  const f = fixture({ fetchImpl: () => new Promise((resolve) => (release = resolve)) });
  const pending = f.player.start(input());
  f.player.stop();
  f.sinks[0].callbacks.onEnded();
  release(audio());
  await pending;
  assert.deepEqual(f.completed, []);
  assert.equal(f.sinks[0].disposed, 1);
});

test("replacing a response rejects the previous turn's ended callback", async () => {
  const f = fixture();
  try {
    await f.player.start(input());
    await f.player.start({ ...input(), messageId: "assistant-b" });
    f.sinks[0].callbacks.onEnded();
    assert.deepEqual(f.completed, []);
    f.sinks[1].callbacks.onEnded();
    assert.equal(f.completed.length, 1);
    assert.equal(f.completed[0].messageId, "assistant-b");
  } finally {
    f.player.stop();
  }
});

test("another response player prevents stale playback completion", async () => {
  const old = fixture(),
    next = fixture();
  try {
    await old.player.start(input());
    await next.player.start({ ...input(), chatId: "chat-b" });
    old.sinks[0].callbacks.onEnded();
    assert.deepEqual(old.completed, []);
    next.sinks[0].callbacks.onEnded();
    assert.equal(next.completed.length, 1);
  } finally {
    old.player.stop();
    next.player.stop();
  }
});

test("playback errors and later ended events cannot resume a conversation", async () => {
  const f = fixture();
  await f.player.start(input());
  f.sinks[0].callbacks.onError();
  f.sinks[0].callbacks.onEnded();
  assert.deepEqual(f.completed, []);
  assert.deepEqual(f.states.at(-1), ["error", "speech_playback_failed"]);
});

test("403 only identifies a model or voice-plan denial when the exact server code is present", async () => {
  for (const [response, expected] of [
    [Response.json({ error: "speech_model_not_eligible" }, { status: 403 }), "speech_not_eligible"],
    [
      Response.json({ error: "speech_voice_plan_required" }, { status: 403 }),
      "speech_voice_plan_required",
    ],
    [Response.json({ error: "email_verification_required" }, { status: 403 }), "speech_forbidden"],
    [new Response("<html>Forbidden</html>", { status: 403 }), "speech_forbidden"],
    [new Response(null, { status: 403 }), "speech_forbidden"],
  ]) {
    const f = fixture({ fetchImpl: async () => response });
    await f.player.start(input());
    assert.deepEqual(f.states.at(-1), ["error", expected]);
    assert.deepEqual(f.completed, []);
    assert.equal(f.sinks[0].disposed, 1);
  }
});

test("Stop cancels an unfinished 403 body before an error verdict", async () => {
  let cancelled = 0;
  const body = new ReadableStream({
    cancel() {
      cancelled++;
    },
  });
  const f = fixture({ fetchImpl: async () => new Response(body, { status: 403 }) });
  const pending = f.player.start(input());
  await new Promise(setImmediate);
  f.player.stop();
  await pending;
  assert.equal(cancelled, 1);
  assert.deepEqual(f.completed, []);
  assert.deepEqual(f.states.at(-1), ["idle"]);
});

test("Stop during natural-end idle notification invalidates the completion callback", async () => {
  let armed = false;
  const f = fixture({
    onState: (state) => {
      if (armed && state === "idle") {
        armed = false;
        f.player.stop();
      }
    },
  });
  await f.player.start(input());
  armed = true;
  f.sinks[0].callbacks.onEnded();
  assert.deepEqual(f.completed, []);
});

test("replacement during natural-end idle notification suppresses the old completion", async () => {
  let armed = false,
    replacement;
  const next = fixture();
  const old = fixture({
    onState: (state) => {
      if (armed && state === "idle") {
        armed = false;
        replacement = next.player.start({ ...input(), chatId: "chat-b" });
      }
    },
  });
  try {
    await old.player.start(input());
    armed = true;
    old.sinks[0].callbacks.onEnded();
    await replacement;
    assert.deepEqual(old.completed, []);
    next.sinks[0].callbacks.onEnded();
    assert.equal(next.completed.length, 1);
  } finally {
    old.player.stop();
    next.player.stop();
  }
});
