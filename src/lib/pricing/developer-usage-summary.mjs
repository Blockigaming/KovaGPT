// Customer-visible analytics only. This is an observed request-history summary,
// not a replacement for the authoritative financial ledger.
const tokenFields = ["input_tokens", "cached_input_tokens", "image_input_tokens", "output_tokens"];
export const developerUsageDimensions = Object.freeze({
  input_tokens: "Input tokens",
  cached_input_tokens: "Cached input tokens",
  image_input_tokens: "Image input tokens",
  output_tokens: "Output tokens",
  web_search_calls: "Web search calls",
  moderation_requests: "Moderation requests",
  transcription_seconds: "Transcription seconds",
  translation_seconds: "Translation seconds",
  speech_character_credits: "Speech character credits",
  realtime_text_input_tokens: "Realtime text input tokens",
  realtime_cached_text_tokens: "Realtime cached text tokens",
  realtime_audio_input_tokens: "Realtime audio input tokens",
  realtime_cached_audio_tokens: "Realtime cached audio tokens",
  realtime_text_output_tokens: "Realtime text output tokens",
  realtime_audio_output_tokens: "Realtime audio output tokens",
  container_1g_sessions: "Isolated 1 GB container sessions",
  browser_sessions_60s: "60-second browser sessions",
});
export function developerUsageDimension(usage, key) {
  if (!Object.hasOwn(developerUsageDimensions, key)) return null;
  const validInteger = (n) => Number.isSafeInteger(n) && n >= 0;
  const value =
    key === "input_tokens" && !validInteger(usage?.input_tokens)
      ? usage?.decision_input_tokens
      : usage?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (key === "transcription_seconds" || key === "translation_seconds")
    return value > 0 && value <= (key === "translation_seconds" ? 10 : 600) ? value : null;
  return Number.isSafeInteger(value) ? value : null;
}
const newTotals = () => ({
  dimensions: Object.fromEntries(
    Object.keys(developerUsageDimensions).map((key) => [key, { measured: 0, total: 0 }]),
  ),
  requests: 0,
  measuredRequests: 0,
  measuredSearchRequests: 0,
  webSearchCalls: 0,
  measuredModerationRequests: 0,
  moderationRequests: 0,
  measuredTranscriptionRequests: 0,
  transcriptionSeconds: 0,
  tokens: Object.fromEntries(tokenFields.map((key) => [key, 0])),
  charges: Object.create(null),
});
// PostgreSQL stores customer charges at scale 8. Sum the returned decimal
// representations as integer ticks to avoid compounding binary-float error.
function chargeTicks(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;
  const match = /^(\d{1,20})(?:\.(\d{1,20}))?(?:e([+-]?\d{1,2}))?$/i.exec(String(value));
  if (!match) return null;
  const fraction = match[2] ?? "";
  const scale = 8 + Number(match[3] ?? 0) - fraction.length;
  if (scale < -20 || scale > 20) return null;
  const digits = BigInt(match[1] + fraction);
  if (scale >= 0) return digits * 10n ** BigInt(scale);
  const divisor = 10n ** BigInt(-scale);
  return digits % divisor === 0n ? digits / divisor : null;
}
function formatTicks(ticks) {
  const digits = ticks.toString().padStart(9, "0");
  return digits.slice(0, -8) + "." + digits.slice(-8);
}
function add(totals, row) {
  totals.requests++;
  const usage = row.authoritative_usage;
  for (const [key, meter] of Object.entries(totals.dimensions)) {
    const value = developerUsageDimension(usage, key);
    if (value !== null) {
      meter.measured++;
      meter.total += value;
    }
  }
  let measured = false;
  for (const field of tokenFields) {
    const value = developerUsageDimension(usage, field);
    if (value !== null) {
      totals.tokens[field] += value;
      measured = true;
    }
  }
  if (measured) totals.measuredRequests++;
  const calls = usage?.web_search_calls;
  if (typeof calls === "number" && Number.isSafeInteger(calls) && calls >= 0) {
    totals.measuredSearchRequests++;
    totals.webSearchCalls += calls;
  }
  const moderations = usage?.moderation_requests;
  if (typeof moderations === "number" && Number.isSafeInteger(moderations) && moderations >= 0) {
    totals.measuredModerationRequests++;
    totals.moderationRequests += moderations;
  }
  const seconds = usage?.transcription_seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= 600) {
    totals.measuredTranscriptionRequests++;
    totals.transcriptionSeconds += seconds;
  }
  if (row.final_customer_charge == null || !/^[A-Z]{3}$/.test(row.currency)) return;
  const value = chargeTicks(row.final_customer_charge);
  if (value === null) return;
  totals.charges[row.currency] = (totals.charges[row.currency] ?? 0n) + value;
}
function group(map, key, row) {
  if (!map.has(key)) map.set(key, newTotals());
  add(map.get(key), row);
}
function finish(totals) {
  return {
    ...totals,
    charges: Object.entries(totals.charges)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: formatTicks(amount) })),
  };
}
export function summarizeDeveloperUsage(rows) {
  const total = newTotals(),
    days = new Map(),
    models = new Map(),
    services = new Map(),
    statuses = new Map();
  for (const row of rows) {
    add(total, row);
    group(days, String(row.created_at).slice(0, 10), row);
    group(models, String(row.public_model), row);
    group(services, String(row.capability), row);
    group(statuses, String(row.settlement_state), row);
  }
  const entries = (map, sort) =>
    [...map].sort(sort).map(([label, totals]) => ({ label, ...finish(totals) }));
  const alphabetic = ([a], [b]) => a.localeCompare(b);
  const byCount = ([a, av], [b, bv]) => bv.requests - av.requests || a.localeCompare(b);
  return {
    ...finish(total),
    days: entries(days, alphabetic),
    models: entries(models, byCount),
    services: entries(services, byCount),
    statuses: entries(statuses, byCount),
  };
}
