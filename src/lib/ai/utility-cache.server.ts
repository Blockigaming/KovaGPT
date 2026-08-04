// Tiny in-memory cache for repetitive utility model calls (chat titles,
// summaries, classifications). Repeated identical work is the cheapest thing
// to eliminate: it never reaches the provider at all.

const MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

type Entry = { value: string; expiresAt: number };
const store = new Map<string, Entry>();

function hashKey(namespace: string, input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `${namespace}:${input.length}:${(hash >>> 0).toString(36)}`;
}

export function readUtilityCache(namespace: string, input: string): string | null {
  const key = hashKey(namespace, input);
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function writeUtilityCache(
  namespace: string,
  input: string,
  value: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  if (!value) return;
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(hashKey(namespace, input), { value, expiresAt: Date.now() + ttlMs });
}

export function clearUtilityCache(): void {
  store.clear();
}
