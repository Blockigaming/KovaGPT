const LIBRARY_IMAGE_BUCKET = "library-images";
const STORAGE_BATCH_SIZE = 1_000;
const MAX_STORAGE_ENTRIES = 10_000;
const MAX_PREFIX_DEPTH = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type StorageError = { message?: string | null };
type StorageEntry = { id?: string | null; name?: string | null };
type StorageBucket = {
  list(
    path: string,
    options: {
      limit: number;
      offset: number;
      sortBy: { column: "name"; order: "asc" };
    },
  ): PromiseLike<{ data: StorageEntry[] | null; error: StorageError | null }>;
  remove(paths: string[]): PromiseLike<{ error: StorageError | null }>;
};

type StorageClient = {
  storage: { from(bucket: string): StorageBucket };
};

function cleanupError(code: string): Error {
  const error = new Error(code);
  error.name = "AccountStorageCleanupError";
  return error;
}

function childPath(prefix: string, entry: StorageEntry): string {
  const name = entry.name;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw cleanupError("account_storage_entry_invalid");
  }
  return `${prefix}/${name}`;
}

/**
 * Discovers a complete prefix before deleting anything, removes files in API
 * sized batches, and verifies the prefix is empty. This keeps metadata intact
 * on discovery/removal failures so a later account-deletion retry can recover.
 */
export async function clearStoragePrefix(
  bucket: StorageBucket,
  rootPrefix: string,
): Promise<number> {
  if (!UUID.test(rootPrefix)) throw cleanupError("account_storage_prefix_invalid");

  const pendingPrefixes = [rootPrefix];
  const visitedPrefixes = new Set<string>();
  const objectPaths: string[] = [];
  let discoveredEntries = 0;

  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.pop()!;
    if (visitedPrefixes.has(prefix)) continue;
    visitedPrefixes.add(prefix);
    if (prefix.split("/").length > MAX_PREFIX_DEPTH) {
      throw cleanupError("account_storage_prefix_depth_exceeded");
    }

    for (let offset = 0; ; offset += STORAGE_BATCH_SIZE) {
      const listed = await bucket.list(prefix, {
        limit: STORAGE_BATCH_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (listed.error || !Array.isArray(listed.data)) {
        throw cleanupError("account_storage_list_failed");
      }

      for (const entry of listed.data) {
        discoveredEntries += 1;
        if (discoveredEntries > MAX_STORAGE_ENTRIES) {
          throw cleanupError("account_storage_entry_limit_exceeded");
        }
        const path = childPath(prefix, entry);
        if (typeof entry.id === "string" && entry.id.length > 0) objectPaths.push(path);
        else if (entry.id === null) pendingPrefixes.push(path);
        else throw cleanupError("account_storage_entry_invalid");
      }

      if (listed.data.length < STORAGE_BATCH_SIZE) break;
    }
  }

  for (let start = 0; start < objectPaths.length; start += STORAGE_BATCH_SIZE) {
    const removed = await bucket.remove(objectPaths.slice(start, start + STORAGE_BATCH_SIZE));
    if (removed.error) throw cleanupError("account_storage_remove_failed");
  }

  const remaining = await bucket.list(rootPrefix, {
    limit: 1,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });
  if (remaining.error || !Array.isArray(remaining.data)) {
    throw cleanupError("account_storage_list_failed");
  }
  if (remaining.data.length !== 0) throw cleanupError("account_storage_cleanup_unverified");
  return objectPaths.length;
}

export async function cleanupLibraryImagesBeforeAccountDeletion(
  client: StorageClient,
  userId: string,
): Promise<number> {
  return clearStoragePrefix(client.storage.from(LIBRARY_IMAGE_BUCKET), userId);
}
