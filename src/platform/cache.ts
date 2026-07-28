type Entry<T> = { value: T; expiresAt: number; staleAt: number; inflight?: Promise<T> };
const cache = new Map<string, Entry<unknown>>();

export async function staleWhileRevalidate<T>(
  key: string,
  load: () => Promise<T>,
  options: { freshMs?: number; staleMs?: number } = {},
): Promise<T> {
  const now = Date.now();
  const freshMs = options.freshMs ?? 30_000;
  const staleMs = options.staleMs ?? 300_000;
  const existing = cache.get(key) as Entry<T> | undefined;
  if (existing && now < existing.expiresAt) return existing.value;
  const refresh =
    existing?.inflight ??
    load()
      .then((value) => {
        cache.set(key, { value, expiresAt: Date.now() + freshMs, staleAt: Date.now() + staleMs });
        return value;
      })
      .catch((error) => {
        if (existing) delete existing.inflight;
        throw error;
      });
  if (existing && now < existing.staleAt) {
    existing.inflight = refresh;
    void refresh.catch(() => undefined);
    return existing.value;
  }
  return refresh;
}
export function invalidateCache(prefix?: string) {
  for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key);
}
export function hydrateCache<T>(key: string, value: T, freshMs = 30_000, staleMs = 300_000) {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + freshMs, staleAt: now + staleMs });
}
