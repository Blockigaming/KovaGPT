// Splits a streaming model reply into speakable segments without waiting for
// the whole reply. Punctuation is kept inside each segment so the TTS model
// can apply natural pauses and intonation. The first segment is cut early (at a
// clause boundary) to minimise time to first audio; later ones prefer full
// sentences so prosody is not chopped up.
const FIRST_MIN = 20;
const SENTENCE_MIN = 48;
const CLAUSE_MIN = 110;
const HARD_MAX = 420;
const ABBREVIATIONS = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|No)\.)$/iu;

/** Remove markup that must not be read aloud, keeping words and punctuation. */
export function speakableText(raw) {
  return String(raw)
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/```[\s\S]*$/u, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/[*_~]{1,3}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function boundary(text, first) {
  // Find the earliest acceptable cut at or after the minimum for this segment.
  const sentenceMin = first ? FIRST_MIN : SENTENCE_MIN;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    const end = i + 1;
    if (end < sentenceMin) continue;
    if (".!?…".includes(ch)) {
      if (next === undefined) return -1; // may continue ("3.5", "...")
      if (!/\s/u.test(next)) continue;
      if (ch === "." && ABBREVIATIONS.test(text.slice(0, end))) continue;
      return end;
    }
    if (first && ",;:—–".includes(ch) && next !== undefined && /\s/u.test(next)) return end;
    if (
      !first &&
      end >= CLAUSE_MIN &&
      ",;:—".includes(ch) &&
      next !== undefined &&
      /\s/u.test(next)
    )
      return end;
    if (end >= HARD_MAX && /\s/u.test(ch)) return end;
  }
  return -1;
}

export function createSpeechSegmenter({ maxSegments = 48 } = {}) {
  let buffer = "";
  let emitted = 0;
  const drain = (final) => {
    const out = [];
    while (emitted < maxSegments) {
      const cut = boundary(buffer, emitted === 0);
      if (cut < 0) break;
      // Never cut inside an unfinished code fence; wait for it to close.
      if (((buffer.slice(0, cut).match(/```/gu) ?? []).length & 1) === 1) break;
      const text = speakableText(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
      if (text) {
        out.push(text);
        emitted++;
      }
    }
    if (final) {
      const rest = speakableText(buffer);
      buffer = "";
      if (rest && emitted < maxSegments) {
        out.push(rest);
        emitted++;
      }
    }
    return out;
  };
  return {
    push(delta) {
      if (typeof delta === "string") buffer += delta;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}
