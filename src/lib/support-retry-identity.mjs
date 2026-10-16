import { principalScopedStorageKey } from "./principal-browser-storage.mjs";

export const SUPPORT_RETRY_STORAGE = "kova-support-retry";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Keep bounded, principal-scoped references in this tab, never message bodies.
 * This is retry identity only: it is not a queue or a delivery receipt. */
export async function supportRetryIdentity(
  storage,
  actor,
  body,
  isCurrent,
  cryptoApi = globalThis.crypto,
  intentionalNewRequest = false,
) {
  const key = principalScopedStorageKey(SUPPORT_RETRY_STORAGE, actor);
  const bytes = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(body));
  if (!isCurrent())
    throw new Error("Support form account changed. Submit from the current account.");
  const digest = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let records = [];
  try {
    const raw = storage?.getItem(key);
    if (raw && raw.length <= 16000) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        records = parsed
          .filter((row) => row && /^[0-9a-f]{64}$/.test(row.digest) && UUID.test(row.requestId))
          .slice(-64);
    }
  } catch {
    /* Unavailable storage retains the caller's in-memory identity. */
  }
  const existing = intentionalNewRequest ? null : records.find((row) => row.digest === digest);
  const requestId = existing?.requestId ?? cryptoApi.randomUUID();
  let persisted = false;
  try {
    const value = JSON.stringify(
      [...records.filter((row) => row.digest !== digest), { digest, requestId }].slice(-64),
    );
    storage?.setItem(key, value);
    persisted = storage?.getItem(key) === value;
  } catch {
    /* The form explicitly limits its retry promise to this open page. */
  }
  return { requestId, persisted };
}
