// Short pre-generated clips ("Let me check that.") that cover genuine delays.
// Clips are static files generated once per configured voice by
// scripts/generate-voice-acks.mjs, so no provider call happens during a turn.
export const ACK_KINDS = Object.freeze({
  search: { id: "check", text: "Let me check that." },
  reasoning: { id: "think", text: "Let me think about that." },
  generic: { id: "moment", text: "Give me a moment." },
});
// Each delay category has its original clip and contextual alternatives. Keep the
// original IDs stable for deployed assets and older clients.
export const ACK_VARIANTS = Object.freeze({
  search: Object.freeze([
    ACK_KINDS.search,
    { id: "look-more", text: "Let me look more into that." },
    { id: "check-details", text: "I'll check a few more details." },
    { id: "dig-deeper", text: "Let me dig a little deeper." },
    { id: "look-closer", text: "I'll take a closer look." },
    { id: "check-sources", text: "Let me check the sources." },
    { id: "verify-details", text: "I'll verify those details." },
    { id: "look-that-up", text: "Let me look that up." },
    { id: "find-details", text: "I'll look for more details." },
    { id: "check-information", text: "Let me check that information." },
    { id: "compare-sources", text: "I'll compare the sources." },
    { id: "check-latest", text: "Let me look for the latest information." },
    { id: "investigate", text: "I'll look into it further." },
    { id: "find-context", text: "Let me find some more context." },
    { id: "check-evidence", text: "I'll check the available evidence." },
    { id: "double-check", text: "Let me double-check that." },
    { id: "look-for-answer", text: "I'll look for a reliable answer." },
    { id: "check-record", text: "Let me check what's available." },
    { id: "review-results", text: "I'm reviewing the results." },
    { id: "find-out-more", text: "Let me find out a little more." },
    { id: "verify-information", text: "I'll try to verify that." },
  ]),
  reasoning: Object.freeze([
    ACK_KINDS.reasoning,
    { id: "work-through", text: "Let me work through that." },
    { id: "consider", text: "I'm considering the details." },
    { id: "think-through", text: "Let me think this through." },
    { id: "break-down", text: "Let me break that down." },
    { id: "weigh-options", text: "I'm weighing the options." },
    { id: "consider-approach", text: "Let me consider the best approach." },
    { id: "put-together", text: "Let me put that together." },
    { id: "work-out", text: "I'll work that out." },
    { id: "sort-details", text: "Let me sort through the details." },
    { id: "connect-points", text: "I'm connecting the pieces." },
    { id: "think-carefully", text: "Let me think carefully about that." },
    { id: "check-reasoning", text: "Let me check my reasoning." },
    { id: "consider-possibilities", text: "I'm considering a few possibilities." },
    { id: "make-sense", text: "Let me make sense of that." },
    { id: "review-options", text: "Let me review the options." },
    { id: "look-at-pieces", text: "I'll look at each part." },
    { id: "work-through-details", text: "I'm working through the details." },
    { id: "think-next-step", text: "Let me think about the next step." },
    { id: "organize-answer", text: "I'm organizing the answer." },
  ]),
  generic: Object.freeze([
    ACK_KINDS.generic,
    { id: "one-moment", text: "One moment." },
    { id: "working", text: "I'm working on it." },
    { id: "just-moment", text: "Just a moment." },
    { id: "one-sec", text: "One second." },
    { id: "give-second", text: "Give me a second." },
    { id: "short-moment", text: "A moment, please." },
    { id: "still-working", text: "I'm still working on that." },
    { id: "on-it", text: "I'm on it." },
    { id: "preparing-reply", text: "I'm preparing the reply." },
    { id: "putting-reply-together", text: "I'm putting the reply together." },
    { id: "little-more-time", text: "I need a little more time." },
    { id: "not-quite-ready", text: "The answer isn't ready quite yet." },
    { id: "working-answer", text: "I'm working on an answer." },
    { id: "taking-moment", text: "This is taking a moment." },
    { id: "getting-answer-ready", text: "I'm getting the answer ready." },
    { id: "continue-working", text: "I'm continuing to work on it." },
    { id: "moment-longer", text: "This needs another moment." },
  ]),
});
// A known search or reasoning delay gets feedback within the one-second target.
// With no known cause a reply is only "late" much later, so the generic clip
// waits; this keeps acknowledgments from delaying replies that were about to start.
export const ACK_DELAYS_MS = Object.freeze({ search: 450, reasoning: 600, generic: 1500 });
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;

export function ackClipUrl(voiceId, kind, variant = 0) {
  const entry = Object.hasOwn(ACK_VARIANTS, kind) ? ACK_VARIANTS[kind][variant] : undefined;
  if (!entry || !SAFE_ID.test(voiceId ?? "")) return null;
  return `/voice-acks/${voiceId}/${entry.id}.mp3`;
}

/**
 * Decides when, and which, acknowledgment plays. At most one per turn, never
 * once real speech has been dispatched, and the most specific known reason
 * (search, then reasoning) wins before the delay expires.
 */
export function createAcknowledgmentPolicy({ delays = ACK_DELAYS_MS } = {}) {
  let kind = "generic";
  let settled = false;
  return {
    /** Milliseconds after end of speech at which the clip for the known reason is due. */
    get delayMs() {
      return delays[kind];
    },
    /** A search/tool step or extended reasoning was detected for this turn. */
    reason(next) {
      if (settled) return;
      if (next === "search" || (next === "reasoning" && kind !== "search")) kind = next;
    },
    /** Real reply audio is being dispatched; no acknowledgment may start any more. */
    realSpeechStarted() {
      settled = true;
    },
    /** Delay expired with nothing audible. Returns the kind once, else null. */
    due() {
      if (settled) return null;
      settled = true;
      return kind;
    },
  };
}

/** In-memory cache of the static clips; a missing clip is remembered and skipped. */
export function createAckCache({ fetchImpl = fetch } = {}) {
  const clips = new Map();
  const cursors = new Map();
  const load = (voiceId, kind, variant = 0) => {
    const url = ackClipUrl(voiceId, kind, variant);
    if (!url) return Promise.resolve(null);
    if (!clips.has(url))
      clips.set(
        url,
        fetchImpl(url, { credentials: "same-origin" })
          .then(async (response) => {
            if (
              !response.ok ||
              response.headers.get("content-type")?.split(";", 1)[0] !== "audio/mpeg"
            )
              return null;
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!bytes.byteLength || bytes.byteLength > 256 * 1024) return null;
            // 128 kbps MP3 is 16000 bytes per second.
            return { bytes, durationMs: Math.round((bytes.byteLength / 16000) * 1000) };
          })
          .catch(() => null),
      );
    return clips.get(url);
  };
  return {
    async get(voiceId, kind) {
      if (!ackClipUrl(voiceId, kind)) return null;
      const variants = ACK_VARIANTS[kind];
      const key = voiceId + ":" + kind;
      const start = cursors.get(key) ?? 0;
      // Advance even if an asset has not been generated. Only one variant
      // plus the original fallback can be requested per turn, regardless of
      // catalog size. Never use a clip recorded for another voice.
      cursors.set(key, (start + 1) % variants.length);
      const clip = await load(voiceId, kind, start);
      return clip ?? (start === 0 ? null : await load(voiceId, kind, 0));
    },
    /** Warm just the three original clips; alternatives load on demand. */
    warm: (voiceId) => Promise.all(Object.keys(ACK_KINDS).map((kind) => load(voiceId, kind))),
  };
}
