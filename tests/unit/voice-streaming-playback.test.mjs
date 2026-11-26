import assert from "node:assert/strict";
import test from "node:test";
import {
  createAckCache,
  createAcknowledgmentPolicy,
  ackClipUrl,
} from "../../src/lib/voice/acknowledgments.mjs";
import {
  createStreamingVoicePlayback,
  parseVoiceSegment,
  predictedDelay,
} from "../../src/lib/voice/streaming-playback.mjs";
import {
  createVoiceLatencyTracker,
  percentile,
  summarizeLatency,
} from "../../src/lib/voice/voice-latency.mjs";

function harness({ clips = true, fetchImpl } = {}) {
  let clock = 0;
  const timers = [];
  const writes = [];
  const states = [];
  const sinkEvents = {};
  let disposed = 0;
  let ended = 0;
  const requests = [];
  const tracker = createVoiceLatencyTracker({ now: () => clock });
  const ackCache = createAckCache({
    fetchImpl: async () =>
      clips
        ? new Response(new Uint8Array(16000), { headers: { "Content-Type": "audio/mpeg" } })
        : new Response("", { status: 404 }),
  });
  const playback = createStreamingVoicePlayback({
    ownerId: "owner-1",
    voiceId: "jessica",
    ackCache,
    tracker,
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.live = false;
    },
    createSink: (events) => {
      Object.assign(sinkEvents, events);
      return {
        async write(bytes) {
          writes.push(bytes.byteLength);
        },
        async end() {
          writes.push("end");
        },
        dispose() {
          disposed++;
        },
      };
    },
    fetchImpl:
      fetchImpl ??
      (async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push(body);
        return new Response(new Uint8Array([body.segmentIndex + 1, 0, 0]), {
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    onState: (state, code) => states.push([state, code]),
    onEnded: () => ended++,
  });
  const advance = async (ms) => {
    clock += ms;
    for (const t of timers.filter((x) => x.live && x.at <= clock)) {
      t.live = false;
      t.fn();
    }
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 4));
  };
  const flush = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 4));
  };
  return {
    playback,
    writes,
    states,
    sinkEvents,
    requests,
    tracker,
    advance,
    flush,
    get disposed() {
      return disposed;
    },
    get ended() {
      return ended;
    },
  };
}
const seg = (index, text = `Segment ${index}.`) => ({
  chatId: "chat-1",
  messageId: "msg-1",
  index,
  text,
  receipt: `receipt-${index}`,
});

test("an acknowledgment plays once after a real delay and is written before the reply", async () => {
  const h = harness();
  await h.ackWarm?.();
  h.playback.begin();
  h.playback.delay("search");
  await h.advance(449);
  assert.deepEqual(h.writes, []);
  await h.advance(1);
  assert.deepEqual(h.writes, [16000]);
  h.sinkEvents.onPlaying();
  assert.equal(h.tracker.records()[0].firstFeedback, 450);
  h.playback.segment(seg(0));
  await h.flush();
  assert.deepEqual(h.writes, [16000, 3]);
  await h.advance(5000);
  assert.equal(h.writes.filter((w) => w === 16000).length, 1);
});

test("no acknowledgment when the reply arrives before the delay, and the real audio is substantive feedback", async () => {
  const h = harness();
  h.playback.begin();
  await h.advance(300);
  h.playback.segment(seg(0));
  await h.advance(1500);
  await h.advance(2000);
  assert.deepEqual(h.writes, [3]);
  h.sinkEvents.onPlaying();
  const r = h.tracker.records();
  assert.deepEqual(
    r.map((x) => Object.keys(x)[0]),
    ["firstFeedback", "firstSubstantive"],
  );
});

test("search is the most specific reason; reasoning never downgrades it; no repeat per turn", () => {
  const p = createAcknowledgmentPolicy();
  p.reason("reasoning");
  p.reason("search");
  p.reason("reasoning");
  assert.equal(p.due(), "search");
  assert.equal(p.due(), null);
  const q = createAcknowledgmentPolicy();
  q.realSpeechStarted();
  assert.equal(q.due(), null);
  assert.equal(ackClipUrl("jessica", "search"), "/voice-acks/jessica/check.mp3");
  assert.equal(ackClipUrl("../x", "search"), null);
});

test("missing clips are skipped silently and the reply still plays", async () => {
  const h = harness({ clips: false });
  h.playback.begin();
  await h.advance(1700);
  assert.deepEqual(h.writes, []);
  h.playback.segment(seg(0));
  await h.flush();
  assert.deepEqual(h.writes, [3]);
});

test("segments are fetched in parallel (max 3) but written in order, then the sink ends", async () => {
  const resolvers = [];
  const h = harness({
    fetchImpl: (url, init) =>
      new Promise((resolve) => {
        const body = JSON.parse(init.body);
        resolvers[body.segmentIndex] = () =>
          resolve(
            new Response(new Uint8Array([body.segmentIndex + 1, 0, 0]), {
              headers: { "Content-Type": "audio/mpeg" },
            }),
          );
      }),
  });
  h.playback.begin();
  for (let i = 0; i < 5; i++) h.playback.segment(seg(i));
  await h.flush();
  assert.equal(resolvers.filter(Boolean).length, 3);
  resolvers[2]();
  resolvers[1]();
  await h.flush();
  assert.deepEqual(h.writes, []);
  resolvers[0]();
  await h.flush();
  assert.deepEqual(h.writes, [3, 3, 3]);
  resolvers[3]();
  resolvers[4]();
  assert.equal(h.playback.finish(), true);
  await h.flush();
  assert.deepEqual(h.writes, [3, 3, 3, 3, 3, "end"]);
});

test("each request carries the exact signed segment and a matching digest, never the receipt in a header", async () => {
  const h = harness();
  h.playback.begin();
  h.playback.segment(seg(0, "Hello there, friend."));
  await h.flush();
  const [r] = h.requests;
  assert.equal(r.mode, "live-segment");
  assert.equal(r.segmentReceipt, "receipt-0");
  assert.equal(r.text, "Hello there, friend.");
  assert.match(r.contentSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(r).sort(), [
    "chatId",
    "contentSha256",
    "messageId",
    "mode",
    "ownerId",
    "segmentIndex",
    "segmentReceipt",
    "text",
    "voiceId",
  ]);
});

test("a denied segment surfaces its code and silences everything", async () => {
  const h = harness({
    fetchImpl: async () => new Response(JSON.stringify({ error: "x" }), { status: 429 }),
  });
  h.playback.begin();
  h.playback.segment(seg(0));
  await h.flush();
  assert.deepEqual(h.states.at(-1), ["error", "speech_limit_reached"]);
  assert.equal(h.disposed >= 1, true);
  assert.equal(h.playback.active, false);
});

test("interrupting stops playback immediately and records interruption latency", async () => {
  const h = harness();
  h.playback.begin();
  h.playback.segment(seg(0));
  await h.flush();
  h.playback.interrupt();
  assert.equal(h.playback.active, false);
  assert.ok(h.disposed >= 1);
  const interrupt = h.tracker.records().find((x) => "interrupt" in x);
  assert.ok(interrupt && interrupt.interrupt >= 0);
  h.playback.segment(seg(1));
  await h.flush();
  assert.equal(h.writes.includes("end"), false);
});

test("natural end calls onEnded once so listening can resume; no segments means fall back", async () => {
  const h = harness();
  h.playback.begin();
  h.playback.segment(seg(0));
  h.playback.finish();
  await h.flush();
  h.sinkEvents.onEnded();
  assert.equal(h.ended, 1);
  const empty = harness();
  empty.playback.begin();
  assert.equal(empty.playback.finish(), false);
});

test("percentiles use nearest rank and ignore missing values", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  const s = summarizeLatency([{ firstFeedback: 500 }, { firstFeedback: 700 }, { interrupt: 12 }]);
  assert.deepEqual(s.firstFeedback, { count: 2, p50: 500, p95: 700 });
  assert.deepEqual(s.firstSubstantive, { count: 0, p50: null, p95: null });
});

test("a reply that is only slightly slow gets no generic acknowledgment; a truly late one does", async () => {
  const quick = harness();
  quick.playback.begin();
  await quick.advance(1400);
  quick.playback.segment(seg(0));
  await quick.flush();
  assert.deepEqual(quick.writes, [3]);
  const late = harness();
  late.playback.begin();
  await late.advance(1500);
  assert.deepEqual(late.writes, [16000]);
  late.playback.delay("search");
  await late.advance(100);
  assert.equal(late.writes.length, 1);
});

test("learning the reason after begin() re-arms the acknowledgment sooner", async () => {
  const h = harness();
  h.playback.begin();
  await h.advance(200);
  h.playback.delay("reasoning");
  await h.advance(399);
  assert.deepEqual(h.writes, []);
  await h.advance(1);
  assert.deepEqual(h.writes, [16000]);
});

import { createBargeInDetector } from "../../src/lib/voice/barge-in.mjs";

test("barge-in ignores Kova's own echo and brief noises but catches sustained user speech", () => {
  const d = createBargeInDetector();
  d.reset(0);
  // Grace period: nothing fires while echo cancellation settles.
  assert.equal(d.feed({ mic: 0.5, playback: 0.1, now: 100 }), false);
  // Loud playback leaking into the mic never triggers.
  for (let t = 500; t < 1500; t += 20)
    assert.equal(d.feed({ mic: 0.12, playback: 0.1, now: t }), false);
  // A short cough does not trigger.
  assert.equal(d.feed({ mic: 0.3, playback: 0.1, now: 1600 }), false);
  assert.equal(d.feed({ mic: 0.01, playback: 0.1, now: 1700 }), false);
  // Sustained speech clearly above the playback level triggers after the hold.
  let fired = false;
  for (let t = 1800; t < 2200 && !fired; t += 20)
    fired = d.feed({ mic: 0.4, playback: 0.1, now: t });
  assert.equal(fired, true);
});

import { readFileSync } from "node:fs";

test("inline Voice keeps the glow for the whole session and shows no Starting/speaking/Resume text", () => {
  const dialog = readFileSync("src/components/ComposerVoiceDialog.tsx", "utf8");
  const view = readFileSync("src/components/ComposerVoiceDialogView.tsx", "utf8");
  const inline = dialog.slice(dialog.indexOf('mode === "voice" && autoStartVoice'));
  // Glow is gated only on error/idle, not on listening or speaking.
  assert.match(inline, /!error && \(startingVoice \|\| phase !== "idle"\)/u);
  // Status remains announced but is visually hidden unless it is an error.
  assert.match(
    inline,
    /role="status" aria-live="polite" className=\{error \? undefined : "sr-only"\}/u,
  );
  assert.doesNotMatch(inline, />\s*Resume\s*</u);
  assert.match(inline, /aria-label="Resume Voice"/u);
  assert.match(view, /startingVoice \? "kova-voice-heading sr-only"/u);
});

test("stream deltas are validated before speaking and request hints only predict delays", () => {
  const receipt = `${"a".repeat(20)}.${"b".repeat(43)}`;
  const ok = { kind: "voice_segment", index: 0, text: "Hello.", receipt };
  assert.deepEqual(parseVoiceSegment(ok, "c", "m"), {
    chatId: "c",
    messageId: "m",
    index: 0,
    text: "Hello.",
    receipt,
  });
  for (const bad of [
    { ...ok, kind: "other" },
    { ...ok, index: 1.5 },
    { ...ok, text: "" },
    { ...ok, text: "x".repeat(1001) },
    { ...ok, receipt: "nope" },
  ])
    assert.equal(parseVoiceSegment(bad, "c", "m"), null);
  assert.equal(predictedDelay("max"), "reasoning");
  assert.equal(predictedDelay("instant"), null);
  assert.equal(predictedDelay(undefined), null);
});
