const AGENT_EVIDENCE_BUCKET = "agent-evidence";
const LIBRARY_IMAGE_BUCKET = "library-images";
const PROJECT_FILE_BUCKET = "project-files";
const STORAGE_BATCH_SIZE = 1_000;
const MAX_REMOVE_BATCHES_PER_REQUEST = 10;
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
type ProjectFileRow = {
  id?: unknown;
  project_id?: unknown;
  storage_path?: unknown;
};
type ProjectFileQueryResult = {
  data: ProjectFileRow[] | null;
  error: StorageError | null;
};
type ProjectFileDeleteQuery = {
  in(column: "id", values: string[]): PromiseLike<{ error: StorageError | null }>;
};
type ProjectFileQuery = {
  select(columns: string): ProjectFileQuery;
  eq(column: "uploaded_by", value: string): ProjectFileQuery;
  order(column: "id", options: { ascending: true }): ProjectFileQuery;
  limit(count: number): PromiseLike<ProjectFileQueryResult>;
  delete(): ProjectFileDeleteQuery;
};
type AccountStorageClient = {
  storage: { from(bucket: string): StorageBucket };
  from(table: "project_files"): unknown;
};

function projectFiles(client: AccountStorageClient): ProjectFileQuery {
  return client.from("project_files") as ProjectFileQuery;
}

export type StorageCleanupProgress = Readonly<{
  complete: boolean;
  removed: number;
}>;

function cleanupError(code: string): Error {
  const error = new Error(code);
  error.name = "AccountStorageCleanupError";
  return error;
}

function cleanupOptions(options: { maxRemoveBatches?: number } = {}): {
  maxRemoveBatches: number;
} {
  const maxRemoveBatches = options.maxRemoveBatches ?? MAX_REMOVE_BATCHES_PER_REQUEST;
  if (!Number.isSafeInteger(maxRemoveBatches) || maxRemoveBatches < 1 || maxRemoveBatches > 100) {
    throw new TypeError("maxRemoveBatches must be an integer between 1 and 100");
  }
  return { maxRemoveBatches };
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
 * Removes at most a bounded number of API-sized object batches, always from
 * offset zero. Successful removals therefore make durable progress, and a
 * retry resumes from the first remaining object rather than repeating a fixed
 * cursor or hitting a permanent total-object ceiling.
 */
export async function clearStoragePrefix(
  bucket: StorageBucket,
  rootPrefix: string,
  options: { maxRemoveBatches?: number } = {},
): Promise<StorageCleanupProgress> {
  if (!UUID.test(rootPrefix)) throw cleanupError("account_storage_prefix_invalid");
  const { maxRemoveBatches } = cleanupOptions(options);

  const pendingPrefixes = [rootPrefix];
  const completedPrefixes = new Set<string>();
  let removalBatches = 0;
  let removed = 0;
  let lastRemovalFingerprint: string | null = null;

  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes[pendingPrefixes.length - 1]!;
    if (prefix.split("/").length > MAX_PREFIX_DEPTH) {
      throw cleanupError("account_storage_prefix_depth_exceeded");
    }

    const listed = await bucket.list(prefix, {
      limit: STORAGE_BATCH_SIZE,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    if (listed.error || !Array.isArray(listed.data)) {
      throw cleanupError("account_storage_list_failed");
    }
    if (listed.data.length === 0) {
      completedPrefixes.add(prefix);
      pendingPrefixes.pop();
      continue;
    }

    const objectPaths: string[] = [];
    const childPrefixes: string[] = [];
    for (const entry of listed.data) {
      const path = childPath(prefix, entry);
      if (typeof entry.id === "string" && entry.id.length > 0) objectPaths.push(path);
      else if (entry.id === null) childPrefixes.push(path);
      else throw cleanupError("account_storage_entry_invalid");
    }

    if (objectPaths.length > 0) {
      const fingerprint = `${prefix}\u0000${objectPaths.join("\u0000")}`;
      if (fingerprint === lastRemovalFingerprint) {
        throw cleanupError("account_storage_cleanup_unverified");
      }
      if (removalBatches >= maxRemoveBatches) return { complete: false, removed };
      const result = await bucket.remove(objectPaths);
      if (result.error) throw cleanupError("account_storage_remove_failed");
      removalBatches += 1;
      removed += objectPaths.length;
      lastRemovalFingerprint = fingerprint;
      continue;
    }

    const nextPrefix = childPrefixes.find((candidate) => !completedPrefixes.has(candidate));
    if (!nextPrefix) {
      // A child that still appears after its verified-empty listing indicates
      // a non-progressing or inconsistent Storage view. Fail instead of loop.
      throw cleanupError("account_storage_cleanup_unverified");
    }
    pendingPrefixes.push(nextPrefix);
  }

  return { complete: true, removed };
}

function validatedProjectFile(
  row: ProjectFileRow,
  userId: string,
): {
  id: string;
  bucket: string;
  path: string;
} {
  if (
    typeof row.id !== "string" ||
    !UUID.test(row.id) ||
    typeof row.project_id !== "string" ||
    !UUID.test(row.project_id) ||
    typeof row.storage_path !== "string" ||
    row.storage_path.length === 0 ||
    row.storage_path.length > 1_024 ||
    row.storage_path.includes("\u0000") ||
    row.storage_path.includes("\\")
  ) {
    throw cleanupError("account_project_storage_entry_invalid");
  }
  const parts = row.storage_path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw cleanupError("account_project_storage_entry_invalid");
  }

  if (parts[0] === row.project_id) {
    return { id: row.id, bucket: PROJECT_FILE_BUCKET, path: row.storage_path };
  }
  // Agent deliverables promoted into a Project historically kept their source
  // object path. The bucket name was dropped, but owner-rooted evidence paths
  // remain distinguishable from canonical Project paths.
  if (parts[0] === userId) {
    return { id: row.id, bucket: AGENT_EVIDENCE_BUCKET, path: row.storage_path };
  }
  throw cleanupError("account_project_storage_entry_invalid");
}

async function cleanupOwnedProjectFiles(
  client: AccountStorageClient,
  userId: string,
  options: { maxRemoveBatches?: number } = {},
): Promise<StorageCleanupProgress> {
  const { maxRemoveBatches } = cleanupOptions(options);
  let removed = 0;

  for (let batch = 0; batch < maxRemoveBatches; batch += 1) {
    const listed = await projectFiles(client)
      .select("id,project_id,storage_path")
      .eq("uploaded_by", userId)
      .order("id", { ascending: true })
      .limit(STORAGE_BATCH_SIZE);
    if (listed.error || !Array.isArray(listed.data)) {
      throw cleanupError("account_project_storage_list_failed");
    }
    if (listed.data.length === 0) return { complete: true, removed };

    const entries = listed.data.map((row) => validatedProjectFile(row, userId));
    const byBucket = new Map<string, string[]>();
    for (const entry of entries) {
      const paths = byBucket.get(entry.bucket) ?? [];
      paths.push(entry.path);
      byBucket.set(entry.bucket, paths);
    }
    for (const [bucket, paths] of byBucket) {
      const result = await client.storage.from(bucket).remove(paths);
      if (result.error) throw cleanupError("account_project_storage_remove_failed");
    }

    // Storage must be gone before metadata is released. Removing these rows
    // makes the next bounded account-deletion retry advance to a new page.
    const deleted = await projectFiles(client)
      .delete()
      .in(
        "id",
        entries.map((entry) => entry.id),
      );
    if (deleted.error) throw cleanupError("account_project_metadata_cleanup_failed");
    removed += entries.length;
  }

  const remaining = await projectFiles(client)
    .select("id,project_id,storage_path")
    .eq("uploaded_by", userId)
    .order("id", { ascending: true })
    .limit(1);
  if (remaining.error || !Array.isArray(remaining.data)) {
    throw cleanupError("account_project_storage_list_failed");
  }
  return { complete: remaining.data.length === 0, removed };
}

/**
 * Removes every app-owned Storage class in failure-safe order. Project files
 * and agent evidence are exhausted before Library images begin, so another
 * bucket can never strand an active account whose Library bytes were removed.
 */
export async function cleanupOwnedStorageBeforeAccountDeletion(
  client: AccountStorageClient,
  userId: string,
  options: { maxRemoveBatches?: number } = {},
): Promise<StorageCleanupProgress> {
  if (!UUID.test(userId)) throw cleanupError("account_storage_prefix_invalid");

  const projectFiles = await cleanupOwnedProjectFiles(client, userId, options);
  if (!projectFiles.complete) return projectFiles;

  const evidence = await clearStoragePrefix(
    client.storage.from(AGENT_EVIDENCE_BUCKET),
    userId,
    options,
  );
  if (!evidence.complete) {
    return { complete: false, removed: projectFiles.removed + evidence.removed };
  }

  const library = await clearStoragePrefix(
    client.storage.from(LIBRARY_IMAGE_BUCKET),
    userId,
    options,
  );
  return {
    complete: library.complete,
    removed: projectFiles.removed + evidence.removed + library.removed,
  };
}
