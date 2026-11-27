// Per-turn voice latency measurements. All times are monotonic milliseconds.
//   firstFeedback    end of user speech -> first audible audio of any kind
//   firstSubstantive end of user speech -> first audible audio of the real reply
//   interrupt        user starts talking over Kova -> playback silenced
// Records stay in memory only and contain no text, audio or identifiers.
const METRICS = ["firstFeedback", "firstSubstantive", "interrupt"];

/** Nearest-rank percentile of a numeric list; null when empty. */
export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

export function summarizeLatency(records) {
  const out = {};
  for (const metric of METRICS) {
    const values = records.map((record) => record[metric]).filter(Number.isFinite);
    out[metric] = {
      count: values.length,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
    };
  }
  return out;
}

export function createVoiceLatencyTracker({
  now = () => performance.now(),
  maxRecords = 200,
} = {}) {
  const records = [];
  let turn = null;
  const record = (metric, value) => {
    records.push({ [metric]: Math.max(0, Math.round(value * 10) / 10) });
    if (records.length > maxRecords) records.shift();
  };
  return {
    /** The user's speech ended; the clock for both response metrics starts here. */
    speechEnded(at = now()) {
      turn = { start: at, feedback: false, substantive: false, interruptAt: null };
    },
    /** Call whenever audio becomes audible; `substantive` marks the real reply. */
    audible({ substantive }) {
      if (!turn) return;
      const at = now();
      if (!turn.feedback) {
        turn.feedback = true;
        record("firstFeedback", at - turn.start);
      }
      if (substantive && !turn.substantive) {
        turn.substantive = true;
        record("firstSubstantive", at - turn.start);
      }
    },
    interruptRequested(at = now()) {
      if (turn) turn.interruptAt = at;
      else turn = { start: at, feedback: true, substantive: true, interruptAt: at };
    },
    interruptSilenced() {
      if (!turn || turn.interruptAt === null) return;
      record("interrupt", now() - turn.interruptAt);
      turn.interruptAt = null;
    },
    records: () => records.slice(),
    summary: () => summarizeLatency(records),
  };
}
