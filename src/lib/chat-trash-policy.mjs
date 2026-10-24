/** Pure retention policy. A month is deliberately exactly 30 days. */
export const DAY_MS = 86_400_000;
export const DEFAULT_TRASH_RETENTION_MS = 30 * DAY_MS;
export const TRASH_RETENTION_OPTIONS = Object.freeze([
  { label: "Instantly", value: 0 },
  { label: "1 hour", value: 3_600_000 },
  { label: "One day", value: DAY_MS },
  { label: "One week", value: 7 * DAY_MS },
  { label: "2 weeks", value: 14 * DAY_MS },
  { label: "One month (30 days)", value: DEFAULT_TRASH_RETENTION_MS },
]);
export function validateRetention(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3650 * DAY_MS)
    throw new Error("Choose a duration between 1 minute and 3,650 days, or Instantly.");
  if (value > 0 && value < 60_000) throw new Error("The shortest custom duration is 1 minute.");
  return value;
}
export function customRetention(amount, unit) {
  const multipliers = { minutes: 60_000, hours: 3_600_000, days: DAY_MS };
  if (!Object.hasOwn(multipliers, unit) || !/^\d+(?:\.\d+)?$/.test(String(amount).trim()))
    throw new Error("Enter a positive custom duration.");
  const value = Number(amount) * multipliers[unit];
  if (value <= 0) throw new Error("Enter a positive custom duration.");
  return validateRetention(value);
}
export function retentionPreview(state, duration, now) {
  validateRetention(duration);
  const entries = state.entries.map((entry) => ({
    ...entry,
    expiresAt: entry.expiresAt <= now ? entry.expiresAt : entry.deletedAt + duration,
  }));
  const expired = entries.filter((entry) => entry.expiresAt <= now);
  return {
    requiresConfirmation: duration === 0 || (duration < state.retentionMs && expired.length > 0),
    expired,
    next: { retentionMs: duration, entries: entries.filter((entry) => entry.expiresAt > now) },
  };
}
export function expireTrash(state, now) {
  return { ...state, entries: state.entries.filter((entry) => entry.expiresAt > now) };
}
