export type HistoricalLibraryAvailability = "loading" | "available" | "unavailable" | "unknown";
type Result = Exclude<HistoricalLibraryAvailability, "loading">;
type Listener = (status: HistoricalLibraryAvailability) => void;
type ReadAvailability = (owner: string, id: string, signal: AbortSignal) => Promise<Result>;

export const HISTORICAL_LIBRARY_LIMITS = {
  concurrent: 2,
  queued: 12,
  cached: 128,
  cacheMs: 30_000,
  unknownCacheMs: 5_000,
  readsPerWindow: 30,
  windowMs: 60_000,
} as const;

type Entry = {
  id: string;
  owner: string;
  epoch: number;
  status: HistoricalLibraryAvailability;
  expiresAt: number;
  listeners: Set<Listener>;
  controller: AbortController;
  expiry?: ReturnType<typeof setTimeout>;
};

/** In-memory, viewport-demanded checks only. No history or Library writes. */
export function createHistoricalLibraryAvailabilityReader(
  read: ReadAvailability,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
) {
  let owner: string | null = null;
  let epoch = 0;
  let retained = 0;
  let active = 0;
  let windowStarted = now();
  let readsInWindow = 0;
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];
  const current = (entry: Entry) =>
    entry.epoch === epoch && entries.get(entry.id) === entry && !entry.controller.signal.aborted;
  const announce = (entry: Entry, status: HistoricalLibraryAvailability) => {
    entry.status = status;
    for (const listener of entry.listeners) listener(status);
  };
  const discard = (entry: Entry) => {
    entry.controller.abort();
    if (entry.expiry !== undefined) timers.clearTimeout(entry.expiry);
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
  };
  const reset = (nextOwner: string | null) => {
    epoch++;
    owner = nextOwner;
    retained = 0;
    for (const entry of entries.values()) {
      discard(entry);
      announce(entry, "unknown");
      entry.listeners.clear();
    }
    queue.length = 0;
    // Keep physical in-flight slots and the read budget across account changes.
    // Even a transport that ignores abort cannot create an unbounded fan-out.
  };
  const complete = (entry: Entry, result: Result) => {
    if (!current(entry)) return;
    const ttl =
      result === "unknown"
        ? HISTORICAL_LIBRARY_LIMITS.unknownCacheMs
        : HISTORICAL_LIBRARY_LIMITS.cacheMs;
    entry.expiresAt = now() + ttl;
    announce(entry, result);
    entry.expiry = timers.setTimeout(() => {
      if (!current(entry)) return;
      discard(entry);
      // Expiration never starts another read or leaves an old missing result
      // indefinitely visible if an item is recreated with the same identity.
      announce(entry, "unknown");
      entry.listeners.clear();
    }, ttl);
  };
  const pump = () => {
    if (now() - windowStarted >= HISTORICAL_LIBRARY_LIMITS.windowMs) {
      windowStarted = now();
      readsInWindow = 0;
    }
    while (active < HISTORICAL_LIBRARY_LIMITS.concurrent && queue.length) {
      const entry = queue.shift()!;
      if (!current(entry)) continue;
      if (readsInWindow >= HISTORICAL_LIBRARY_LIMITS.readsPerWindow) {
        complete(entry, "unknown");
        continue;
      }
      active++;
      readsInWindow++;
      void Promise.resolve()
        .then(() => {
          entry.controller.signal.throwIfAborted();
          return read(entry.owner, entry.id, entry.controller.signal);
        })
        .then(
          (result) =>
            complete(
              entry,
              result === "available" || result === "unavailable" ? result : "unknown",
            ),
          () => complete(entry, "unknown"),
        )
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    /** Mounted chips retain one account scope; the last unmount clears it. */
    retainOwner(nextOwner: string | null) {
      if (owner !== nextOwner) reset(nextOwner);
      const retainedEpoch = epoch;
      retained++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (retainedEpoch === epoch && --retained === 0) reset(null);
      };
    },
    subscribe(expectedOwner: string, id: string, listener: Listener, refresh = false) {
      if (owner !== expectedOwner || !retained || !id) {
        listener("unknown");
        return () => {};
      }
      let entry = entries.get(id);
      if (entry && entry.status !== "loading" && (refresh || entry.expiresAt <= now())) {
        if (queue.length >= HISTORICAL_LIBRARY_LIMITS.queued) {
          listener("unknown");
          return () => {};
        }
        if (entry.expiry !== undefined) timers.clearTimeout(entry.expiry);
        entry.expiresAt = 0;
        announce(entry, "loading");
        queue.push(entry);
      }
      if (!entry) {
        // Remove only inactive cache records. Live subscriptions never force an
        // unbounded queue/cache when a very long history is rendered at once.
        for (const cached of entries.values()) {
          if (entries.size < HISTORICAL_LIBRARY_LIMITS.cached) break;
          if (cached.status !== "loading" && !cached.listeners.size) discard(cached);
        }
        if (
          entries.size >= HISTORICAL_LIBRARY_LIMITS.cached ||
          queue.length >= HISTORICAL_LIBRARY_LIMITS.queued
        ) {
          listener("unknown");
          return () => {};
        }
        entry = {
          id,
          owner: expectedOwner,
          epoch,
          status: "loading",
          expiresAt: 0,
          listeners: new Set(),
          controller: new AbortController(),
        };
        entries.set(id, entry);
        queue.push(entry);
      }
      const subscribed = entry;
      subscribed.listeners.add(listener);
      listener(subscribed.status);
      pump();
      return () => {
        subscribed.listeners.delete(listener);
        if (!subscribed.listeners.size && subscribed.status === "loading") discard(subscribed);
      };
    },
  };
}
