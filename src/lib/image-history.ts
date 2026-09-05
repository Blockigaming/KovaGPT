export type ImageHistoryItem = {
  id: string;
  prompt: string;
  imageUrl: string;
  createdAt: number;
  objectUrl?: boolean;
};

type StoredImageHistoryItem = {
  userKey: string;
  id: string;
  prompt: string;
  createdAt: number;
  image: Blob;
};

const DATABASE_NAME = "kovagpt-image-history";
const DATABASE_VERSION = 1;
const STORE_NAME = "images";
const USER_INDEX = "userKey";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const mutationQueues = new Map<string, Promise<void>>();

function enqueueImageHistoryMutation<T>(userKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(userKey) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(userKey, settled);
  void settled.then(() => {
    if (mutationQueues.get(userKey) === settled) mutationQueues.delete(userKey);
  });
  return result;
}

async function waitForImageHistoryMutations(userKey: string): Promise<void> {
  await mutationQueues.get(userKey);
}

function openImageHistoryDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Persistent image history is unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: ["userKey", "id"],
        });
        store.createIndex(USER_INDEX, "userKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Image history could not be opened"));
    request.onblocked = () => reject(new Error("Image history upgrade was blocked"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Image history transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Image history transaction was aborted"));
  });
}

async function readImageBlob(imageUrl: string): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) throw new Error("Generated image could not be read");
    const image = await response.blob();
    const contentType = image.type.toLowerCase().split(";", 1)[0];
    if (!SAFE_IMAGE_TYPES.has(contentType) || image.size === 0 || image.size > MAX_IMAGE_BYTES) {
      throw new Error("Generated image cannot be stored in browser history");
    }
    return image;
  } finally {
    clearTimeout(timeout);
  }
}

function isStoredImageHistoryItem(value: unknown): value is StoredImageHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredImageHistoryItem>;
  return (
    typeof item.userKey === "string" &&
    typeof item.id === "string" &&
    typeof item.prompt === "string" &&
    typeof item.createdAt === "number" &&
    Number.isFinite(item.createdAt) &&
    item.image instanceof Blob &&
    item.image.size > 0 &&
    item.image.size <= MAX_IMAGE_BYTES &&
    SAFE_IMAGE_TYPES.has(item.image.type.toLowerCase().split(";", 1)[0])
  );
}

export async function loadImageHistory(
  userKey: string,
  limit: number,
): Promise<ImageHistoryItem[]> {
  await waitForImageHistoryMutations(userKey);
  const database = await openImageHistoryDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const request = transaction.objectStore(STORE_NAME).index(USER_INDEX).getAll(userKey);
    const records = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Image history could not be loaded"));
    });
    await completion;
    return records
      .filter(isStoredImageHistoryItem)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        prompt: item.prompt,
        imageUrl: URL.createObjectURL(item.image),
        createdAt: item.createdAt,
        objectUrl: true,
      }));
  } finally {
    database.close();
  }
}

export async function persistImageHistoryItem(
  userKey: string,
  item: ImageHistoryItem,
  limit: number,
): Promise<void> {
  // Start byte capture immediately. Database mutations remain serialized, but
  // legacy images can be read in parallel during the one-time migration.
  const imageResultPromise = readImageBlob(item.imageUrl).then(
    (image) => ({ ok: true as const, image }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return enqueueImageHistoryMutation(userKey, async () => {
    const imageResult = await imageResultPromise;
    if (!imageResult.ok) throw imageResult.error;
    const image = imageResult.image;
    const database = await openImageHistoryDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put({
        userKey,
        id: item.id,
        prompt: item.prompt,
        createdAt: item.createdAt,
        image,
      } satisfies StoredImageHistoryItem);

      const recordsRequest = store.index(USER_INDEX).getAll(userKey);
      recordsRequest.onsuccess = () => {
        const records = (recordsRequest.result as unknown[])
          .filter(isStoredImageHistoryItem)
          .sort((left, right) => right.createdAt - left.createdAt);
        for (const stale of records.slice(limit)) {
          store.delete([userKey, stale.id]);
        }
      };
      recordsRequest.onerror = () => transaction.abort();
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  });
}

export async function deleteImageHistoryItem(userKey: string, id: string): Promise<void> {
  return enqueueImageHistoryMutation(userKey, async () => {
    const database = await openImageHistoryDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete([userKey, id]);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  });
}

export async function clearImageHistory(userKey: string): Promise<void> {
  return enqueueImageHistoryMutation(userKey, async () => {
    const database = await openImageHistoryDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const keysRequest = store.index(USER_INDEX).getAllKeys(userKey);
      keysRequest.onsuccess = () => {
        for (const key of keysRequest.result) store.delete(key);
      };
      keysRequest.onerror = () => transaction.abort();
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  });
}
