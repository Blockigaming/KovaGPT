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
 * Tracks both queued and completed snapshots while serializing durable writes.
 * Comparing both values preserves A → B → A and B → C → B edits even when the
 * effect that owned the first B is cancelled before its write settles.
 */
export function createSerializedSnapshotQueue<T>(initialSnapshot: T) {
  const writes = createSerializedWriteQueue();
  let generation = 0;
  let lastEnqueued = initialSnapshot;
  let lastCompleted = initialSnapshot;
  let latestPending:
    | { generation: number; snapshot: T; promise: Promise<unknown> }
    | undefined;

  return {
    reset(snapshot: T): void {
      generation += 1;
      lastEnqueued = snapshot;
      lastCompleted = snapshot;
      latestPending = undefined;
    },
    needsEnqueue(snapshot: T): boolean {
      return !Object.is(snapshot, lastEnqueued) || !Object.is(snapshot, lastCompleted);
    },
    mark(snapshot: T): void {
      lastEnqueued = snapshot;
      lastCompleted = snapshot;
    },
    enqueue<R>(snapshot: T, write: (value: T) => Promise<R>): Promise<R> {
      const pending = latestPending;
      if (
        pending &&
        pending.generation === generation &&
        Object.is(pending.snapshot, snapshot) &&
        Object.is(lastEnqueued, snapshot)
      ) {
        return pending.promise as Promise<R>;
      }

      const writeGeneration = generation;
      lastEnqueued = snapshot;
      const result = writes.enqueue(async () => {
        const value = await write(snapshot);
        if (generation === writeGeneration) lastCompleted = snapshot;
        return value;
      });
      latestPending = { generation: writeGeneration, snapshot, promise: result };
      void result.finally(() => {
        if (latestPending?.promise === result) latestPending = undefined;
      });
      return result;
    },
  };
}
