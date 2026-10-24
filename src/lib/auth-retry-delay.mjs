/** Honor a server delay without deriving account state from a rejected request. */
export function authRetryDelay(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds) ? Math.min(seconds, 2147483) : null;
  }
  if (!/^[A-Za-z]{3}, /.test(raw)) return null;
  const instant = Date.parse(raw);
  return Number.isFinite(instant)
    ? Math.min(2147483, Math.max(0, Math.ceil((instant - now) / 1000)))
    : null;
}
