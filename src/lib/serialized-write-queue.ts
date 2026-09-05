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
