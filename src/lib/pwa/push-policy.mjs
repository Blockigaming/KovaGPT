const HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);
export function pushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("push_subscription_invalid");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname.length < 8 ||
    /%2f|%5c|\.\./iu.test(url.pathname)
  )
    throw new Error("push_service_unsupported");
  return url;
}
export function decodePushKey(value, size) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 200)
    throw new Error("push_key_invalid");
  const bytes = Uint8Array.from(atob(value.replace(/-/gu, "+").replace(/_/gu, "/")), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.length !== size || encodePushKey(bytes) !== value || (size === 65 && bytes[0] !== 4))
    throw new Error("push_key_invalid");
  return bytes;
}
export function encodePushKey(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
export function normalizePushSubscription(input) {
  if (!input || typeof input !== "object" || !input.keys)
    throw new Error("push_subscription_invalid");
  const endpoint = pushEndpoint(input.endpoint).href;
  decodePushKey(input.keys.p256dh, 65);
  decodePushKey(input.keys.auth, 16);
  return { endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth };
}
export function normalizeQuietHours(value) {
  if (value === null || value === undefined) return null;
  if (
    !value ||
    typeof value !== "object" ||
    !/^\d{2}:\d{2}$/u.test(value.start ?? "") ||
    !/^\d{2}:\d{2}$/u.test(value.end ?? "") ||
    typeof value.timeZone !== "string" ||
    value.timeZone.length > 100
  )
    throw new Error("push_quiet_hours_invalid");
  for (const time of [value.start, value.end])
    if (Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59)
      throw new Error("push_quiet_hours_invalid");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format();
  } catch {
    throw new Error("push_quiet_hours_invalid");
  }
  return { start: value.start, end: value.end, timeZone: value.timeZone };
}
export function isPushQuiet(value, now = Date.now()) {
  const hours = normalizeQuietHours(value);
  if (!hours) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: hours.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const time = `${parts.find((p) => p.type === "hour").value}:${parts.find((p) => p.type === "minute").value}`;
  if (hours.start === hours.end) return true;
  return hours.start < hours.end
    ? time >= hours.start && time < hours.end
    : time >= hours.start || time < hours.end;
}
