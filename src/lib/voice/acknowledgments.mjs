// Short pre-generated clips ("Let me check that.") that cover genuine delays.
// Clips are static files generated once per configured voice by
// scripts/generate-voice-acks.mjs, so no provider call happens during a turn.
export const ACK_KINDS = Object.freeze({
  search: { id: "check", text: "Let me check that." },
  reasoning: { id: "think", text: "Let me think about that." },
  generic: { id: "moment", text: "Give me a moment." },
});
// A known search or reasoning delay gets feedback within the one-second target.
// With no known cause a reply is only "late" much later, so the generic clip
// waits; this keeps acknowledgments from delaying replies that were about to start.
export const ACK_DELAYS_MS = Object.freeze({ search: 450, reasoning: 600, generic: 1500 });
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;

export function ackClipUrl(voiceId, kind) {
  const entry = ACK_KINDS[kind];
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
  const load = (voiceId, kind) => {
    const url = ackClipUrl(voiceId, kind);
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
    get: load,
    /** Preload every clip for a voice when a Voice session starts. */
    warm: (voiceId) => Promise.all(Object.keys(ACK_KINDS).map((kind) => load(voiceId, kind))),
  };
}
