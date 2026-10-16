import { principalScopedStorageKey } from "./principal-browser-storage.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bounded per-tab retry references, never evaluation notes or provider credentials. */
export async function promptEvaluationIdentity(
  storage,
  actor,
  payload,
  isCurrent,
  intentionalNew = false,
  cryptoApi = globalThis.crypto,
) {
  const key = principalScopedStorageKey("kova-prompt-evaluation-retries", actor);
  if (!key || typeof actor !== "string" || !actor)
    throw new Error("Prompt evaluation account is unresolved.");
  const digest = Array.from(
    new Uint8Array(
      await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload))),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (!isCurrent()) throw new Error("Prompt evaluation context changed.");
  let records = [];
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      if (raw.length > 16000) throw new Error();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error();
      records = parsed
        .filter((row) => row && /^[0-9a-f]{64}$/.test(row.digest) && UUID.test(row.requestId))
        .slice(-64);
    }
  } catch {
    throw new Error(
      "Evaluation retry history could not be read. Preserve your notes and review saved evaluations before clearing local recovery.",
    );
  }
  const requestId =
    (!intentionalNew && records.find((row) => row.digest === digest)?.requestId) ||
    cryptoApi.randomUUID();
  try {
    const value = JSON.stringify(
      [...records.filter((row) => row.digest !== digest), { digest, requestId }].slice(-64),
    );
    storage?.setItem(key, value);
    if (storage?.getItem(key) !== value) throw new Error();
  } catch {
    throw new Error(
      "Evaluation retry identity could not be saved in this tab. Your notes are retained; restore browser storage before saving.",
    );
  }
  return requestId;
}
