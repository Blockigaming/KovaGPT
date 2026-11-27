#!/usr/bin/env node
// SYNTHETIC benchmark of the real streaming playback engine against simulated
// model and TTS latencies. It measures our pipeline's own behaviour (ack timing,
// segment dispatch, interruption) under stated assumptions; it is NOT a
// production measurement. Production numbers come from the in-app tracker
// (window.__kovaVoiceLatency.summary()) or the real-device run in the PR notes.
import { createAckCache } from "../src/lib/voice/acknowledgments.mjs";
import { createStreamingVoicePlayback } from "../src/lib/voice/streaming-playback.mjs";
import { createVoiceLatencyTracker, summarizeLatency } from "../src/lib/voice/voice-latency.mjs";

const TURNS = Number(process.env.TURNS ?? 300);
const TTS_MEDIAN_MS = Number(process.env.TTS_TTFB_MS ?? 220); // provider + network to first byte
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const lognormal = (median, sigma) =>
  median *
  Math.exp(sigma * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()));

const ackBytes = new Uint8Array(16000 * 1.3);
const records = [];
const baseline = [];

async function turn(searchTurn) {
  const tracker = createVoiceLatencyTracker();
  const ackCache = createAckCache({
    fetchImpl: async () => new Response(ackBytes, { headers: { "Content-Type": "audio/mpeg" } }),
  });
  await ackCache.warm("jessica");
  let sinkEvents;
  const playback = createStreamingVoicePlayback({
    ownerId: "o",
    voiceId: "jessica",
    ackCache,
    tracker,
    createSink: (events) => {
      sinkEvents = events;
      let first = true;
      return {
        async write() {
          if (first) {
            first = false;
            setTimeout(() => sinkEvents.onPlaying(), 15); // decode + output start
          }
        },
        async end() {},
        dispose() {},
      };
    },
    fetchImpl: async () => {
      await sleep(lognormal(TTS_MEDIAN_MS, 0.35));
      return new Response(new Uint8Array(4000), { headers: { "Content-Type": "audio/mpeg" } });
    },
  });
  playback.begin();
  const firstSentence = searchTurn ? lognormal(3200, 0.4) : lognormal(900, 0.45);
  if (searchTurn) setTimeout(() => playback.delay("search"), 400);
  await sleep(firstSentence);
  playback.segment({
    chatId: "c",
    messageId: "m",
    index: 0,
    text: "First sentence.",
    receipt: "r",
  });
  await sleep(1800); // let audible marks land
  // Interrupt while speaking.
  playback.interrupt();
  records.push(...tracker.records());
  // Previous pipeline: wait for the entire reply (~4x first sentence), persist, then synthesize.
  baseline.push({
    firstFeedback: firstSentence * 4 + 300 + lognormal(TTS_MEDIAN_MS * 1.4, 0.35),
    firstSubstantive: firstSentence * 4 + 300 + lognormal(TTS_MEDIAN_MS * 1.4, 0.35),
  });
}

await Promise.all(Array.from({ length: TURNS }, (_, i) => turn(i % 10 < 3)));
const fmt = (s) =>
  Object.fromEntries(
    Object.entries(s).map(([k, v]) => [
      k,
      `n=${v.count} p50=${v.p50 === null ? "-" : Math.round(v.p50)}ms p95=${v.p95 === null ? "-" : Math.round(v.p95)}ms`,
    ]),
  );
console.log(`SYNTHETIC, ${TURNS} turns (30% search), TTS first-byte median ${TTS_MEDIAN_MS}ms`);
console.log("streaming + acknowledgments:", fmt(summarizeLatency(records)));
console.log(
  "previous pipeline (modelled):",
  fmt(summarizeLatency(baseline.map((b) => ({ ...b })))),
);
