const NAME = "kovagpt-chat-history-v1";
const queues = new Map();
function enqueue(ownerId, operation) {
  const current = (queues.get(ownerId) ?? Promise.resolve()).then(operation);
  queues.set(
    ownerId,
    current.catch(() => {}),
  );
  return current;
}
async function open() {
  if (typeof indexedDB === "undefined") throw new Error("chat_history_device_unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("meta", { keyPath: "ownerId" });
      db.createObjectStore("records", { keyPath: ["ownerId", "id"] }).createIndex(
        "ownerId",
        "ownerId",
      );
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () =>
      reject(new Error("chat_history_device_unavailable"));
  });
}
function completion(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(new Error("chat_history_device_unavailable"));
  });
}
function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("chat_history_device_unavailable"));
  });
}
export async function loadChatHistoryDevice(ownerId) {
  await queues.get(ownerId);
  const db = await open();
  try {
    const tx = db.transaction(["meta", "records"], "readonly"),
      done = completion(tx);
    const [meta, rows] = await Promise.all([
      result(tx.objectStore("meta").get(ownerId)),
      result(tx.objectStore("records").index("ownerId").getAll(IDBKeyRange.only(ownerId), 10001)),
      done,
    ]);
    if (!meta) return null;
    if (rows.length > 10000) throw new Error("chat_history_device_unavailable");
    return { ...meta, records: Object.fromEntries(rows.map(({ id, record }) => [id, record])) };
  } finally {
    db.close();
  }
}
export async function commitChatHistoryDevice(previous, next, { signal } = {}) {
  return enqueue(next.ownerId, async () => {
    if (signal?.aborted) throw new Error("chat_history_canceled");
    const db = await open();
    let abort;
    try {
      if (signal?.aborted) throw new Error("chat_history_canceled");
      const tx = db.transaction(["meta", "records"], "readwrite"),
        done = completion(tx);
      abort = () => {
        try {
          tx.abort();
        } catch {
          /* Already committed. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      // Check the persistent reset generation in the same transaction as every
      // write, including I/O initiated by a tab before another tab erased it.
      // Capture stores while the transaction is active. A WebKit navigation or
      // aborted writer may invalidate it before a queued success callback runs.
      const metadataStore = tx.objectStore("meta");
      const records = tx.objectStore("records");
      const check = metadataStore.get(next.ownerId);
      const writes = new Promise((resolve, reject) => {
        check.onerror = () => reject(new Error("chat_history_device_unavailable"));
        check.onsuccess = () => {
          try {
            if (signal?.aborted) throw new Error("chat_history_canceled");
            const meta = check.result;
            if (meta && meta.localEpoch !== next.localEpoch)
              throw new Error("chat_history_device_unavailable");
            for (const [id, record] of Object.entries(next.records))
              if (previous?.records[id] !== record)
                records.put({ ownerId: next.ownerId, id, record });
            for (const id of Object.keys(previous?.records ?? {}))
              if (!Object.hasOwn(next.records, id)) records.delete([next.ownerId, id]);
            const { records: ignored, ...metadata } = next;
            metadataStore.put(metadata);
            resolve();
          } catch (error) {
            reject(error);
            abort();
          }
        };
      });
      await Promise.all([done, writes]);
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      db.close();
    }
  });
}
export async function clearChatHistoryDevice(ownerId) {
  return enqueue(ownerId, async () => {
    const db = await open();
    try {
      const tx = db.transaction(["meta", "records"], "readwrite"),
        done = completion(tx);
      const cursor = tx
        .objectStore("records")
        .index("ownerId")
        .openCursor(IDBKeyRange.only(ownerId));
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        cursor.result.delete();
        cursor.result.continue();
      };
      tx.objectStore("meta").put({
        version: 1,
        ownerId,
        localEpoch: crypto.randomUUID(),
        epoch: null,
        cursor: 0,
        complete: false,
        cleared: true,
      });
      await done;
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("kova-chat-history");
        channel.postMessage({ ownerId, reset: true });
        channel.close();
      }
    } finally {
      db.close();
    }
  });
}
