/**
 * Runs writes in enqueue order. A rejected write does not poison the queue, so
 * a later snapshot can still become the durable value.
 */
export function createSerializedWriteQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(write: () => Promise<T>): Promise<T> {
      const result = tail.catch(() => undefined).then(write);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

/**
 * Tracks the latest snapshot synchronously while serializing its durable write.
 * This prevents an A → B → A edit from mistaking the final A for the already
 * durable initial value while B is still in flight.
 */
export function createSerializedSnapshotQueue<T>(initialSnapshot: T) {
  const writes = createSerializedWriteQueue();
  let lastEnqueued = initialSnapshot;

  return {
    reset(snapshot: T): void {
      lastEnqueued = snapshot;
    },
    needsEnqueue(snapshot: T): boolean {
      return !Object.is(snapshot, lastEnqueued);
    },
    mark(snapshot: T): void {
      lastEnqueued = snapshot;
    },
    enqueue<R>(snapshot: T, write: (value: T) => Promise<R>): Promise<R> {
      lastEnqueued = snapshot;
      return writes.enqueue(() => write(snapshot));
    },
  };
}
