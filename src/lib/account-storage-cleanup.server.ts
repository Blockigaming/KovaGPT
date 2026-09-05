import { transferRetainedAccountSource } from "./account-retained-source-transfer.server.ts";
import { claimProjectStorageSourceCleanup } from "./project-storage-references.server.ts";
import {
  AGENT_EVIDENCE_BUCKET,
  PROJECT_FILE_BUCKET,
  validateStorageObjectPath,
  resolveProjectFileStorage,
  type StorageReferenceAssociation,
  type StorageReferenceRow,
} from "./project-file-storage-policy.mjs";

const LIBRARY_IMAGE_BUCKET = "library-images";
const STORAGE_BATCH_SIZE = 1_000;
const MAX_REMOVE_BATCHES_PER_REQUEST = 10;
const MAX_PREFIX_DEPTH = 32;
const ASSOCIATION_QUERY_BATCH_SIZE = 100;
const MAX_ASSOCIATED_ROWS_PER_BATCH = 10_000;
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
  uploaded_by?: unknown;
  kind?: unknown;
  status?: unknown;
  delete_attempt_id?: unknown;
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
  eq(column: "uploaded_by" | "projects.owner_id", value: string): ProjectFileQuery;
  order(column: "id", options: { ascending: true }): ProjectFileQuery;
  limit(count: number): PromiseLike<ProjectFileQueryResult>;
  delete(): ProjectFileDeleteQuery;
};
type AccountStorageClient = {
  storage: { from(bucket: string): StorageBucket };
  from(table: string): unknown;
  rpc: unknown;
};

type AssociationQuery = {
  select(columns: string): AssociationQuery;
  in(column: string, values: unknown[]): AssociationQuery;
  eq(column: string, value: unknown): AssociationQuery;
  order(column: string, options: { ascending: true }): AssociationQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: StorageError | null;
  }>;
};

async function storageRpc(
  client: AccountStorageClient,
  name: string,
  args: Record<string, unknown>,
) {
  if (typeof client.rpc !== "function")
    throw cleanupError("account_project_storage_rpc_unavailable");
  return (
    client.rpc as (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: StorageError | null }>
  ).call(client, name, args);
}

function projectFiles(client: AccountStorageClient): ProjectFileQuery {
  return client.from("project_files") as ProjectFileQuery;
}

async function readAssociatedRows(
  client: AccountStorageClient,
  table: string,
  column: string,
  values: unknown[],
  columns = "*",
  equality?: { column: string; value: unknown },
): Promise<Record<string, unknown>[]> {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) return [];
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start < uniqueValues.length; start += ASSOCIATION_QUERY_BATCH_SIZE) {
    const batch = uniqueValues.slice(start, start + ASSOCIATION_QUERY_BATCH_SIZE);
    let exhausted = false;
    for (let offset = 0; offset < MAX_ASSOCIATED_ROWS_PER_BATCH; offset += STORAGE_BATCH_SIZE) {
      let query = (client.from(table) as AssociationQuery).select(columns).in(column, batch);
      if (equality) query = query.eq(equality.column, equality.value);
      const result = await query
        .order("id", { ascending: true })
        .range(offset, offset + STORAGE_BATCH_SIZE - 1);
      if (result.error || !Array.isArray(result.data)) {
        throw cleanupError("account_project_storage_reference_lookup_failed");
      }
      rows.push(...result.data);
      if (result.data.length < STORAGE_BATCH_SIZE) {
        exhausted = true;
        break;
      }
    }
    if (!exhausted) throw cleanupError("account_project_storage_reference_limit_exceeded");
  }
  return rows;
}

async function loadProjectFileAssociations(
  client: AccountStorageClient,
  rows: ProjectFileRow[],
): Promise<Map<string, StorageReferenceAssociation>> {
  const rowIds = rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
  const rowIdSet = new Set(rowIds);
  const promotions = (
    await readAssociatedRows(
      client,
      "agent_resource_promotions",
      "destination_id",
      rowIds,
      "id,destination_id,destination_type,status,project_id,owner_id,deliverable_id",
    )
  ).filter(
    (row) => row.destination_type === "project_file" && rowIdSet.has(String(row.destination_id)),
  );
  const deliverables = await readAssociatedRows(
    client,
    "agent_deliverables",
    "id",
    promotions.map((row) => row.deliverable_id),
    "id,owner_id,storage_reference",
  );
  const deliverableById = new Map(deliverables.map((row) => [row.id, row]));
  const result = new Map<string, StorageReferenceAssociation>();
  for (const promotion of promotions) {
    const destinationId = promotion.destination_id;
    const deliverable = deliverableById.get(promotion.deliverable_id);
    if (typeof destinationId !== "string" || result.has(destinationId) || !deliverable) {
      throw cleanupError("account_project_storage_reference_invalid");
    }
    result.set(destinationId, {
      promotion: promotion as StorageReferenceAssociation["promotion"],
      deliverable: deliverable as StorageReferenceAssociation["deliverable"],
    });
  }
  return result;
}

async function externallyReferencedProjectObjects(
  client: AccountStorageClient,
  entries: Array<{ bucket: string; path: string }>,
  deletingIds: Set<string>,
  userId: string,
): Promise<Set<string>> {
  // Both canonical rows and promoted rows can be the last live reference.
  // Resolve every matching row through its authoritative promotion metadata so
  // an agent-evidence path collision cannot authorize project-files removal.
  const candidates = await readAssociatedRows(
    client,
    "project_files",
    "storage_path",
    entries.filter((entry) => entry.bucket === PROJECT_FILE_BUCKET).map((entry) => entry.path),
    "id,project_id,storage_path,uploaded_by,kind,status,delete_attempt_id",
  );
  const candidateIds = candidates.map((row) => row.id);
  // A row outside the current page may still disappear later in this deletion.
  const ownedProjectDestinations = await readAssociatedRows(
    client,
    "project_files",
    "id",
    candidateIds,
    "id,projects!inner(owner_id)",
    { column: "projects.owner_id", value: userId },
  );
  const pendingDeletionIds = new Set([
    ...deletingIds,
    ...ownedProjectDestinations.map((row) => row.id),
  ]);
  const remaining = candidates.filter(
    (row) => row.uploaded_by !== userId && !pendingDeletionIds.has(row.id),
  );
  const associations = await loadProjectFileAssociations(client, remaining);
  const referenced = new Set<string>();
  // A Work deliverable remains a live owner of these bytes after its Project
  // FK is set null. Only this account's deliverables disappear with Auth.
  const survivingDeliverables = await readAssociatedRows(
    client,
    "agent_deliverables",
    "storage_reference",
    entries
      .filter((entry) => entry.bucket === PROJECT_FILE_BUCKET)
      .map((entry) => `${PROJECT_FILE_BUCKET}:${entry.path}`),
    "id,owner_id,storage_reference,status",
  );
  for (const deliverable of survivingDeliverables) {
    if (deliverable.owner_id === userId || deliverable.status === "deleted") continue;
    if (
      typeof deliverable.owner_id !== "string" ||
      !UUID.test(deliverable.owner_id) ||
      typeof deliverable.storage_reference !== "string"
    ) {
      throw cleanupError("account_project_storage_reference_invalid");
    }
    referenced.add(deliverable.storage_reference);
  }
  for (const row of remaining) {
    try {
      const source = resolveProjectFileStorage(
        row as StorageReferenceRow,
        typeof row.id === "string" ? associations.get(row.id) : undefined,
      );
      if (source.bucket === PROJECT_FILE_BUCKET) {
        referenced.add(`${source.bucket}:${source.path}`);
      }
    } catch {
      throw cleanupError("account_project_storage_reference_invalid");
    }
  }
  return referenced;
}

/**
 * Browser uploads acquire Storage ownership before metadata registration. Use
 * the service-only read RPC to discover every remaining owned object even if
 * registration failed, and remove bytes through Storage (never SQL deletion).
 */
async function cleanupUnregisteredOwnedProjectObjects(
  client: AccountStorageClient,
  userId: string,
  options: { maxRemoveBatches?: number } = {},
): Promise<StorageCleanupProgress> {
  const { maxRemoveBatches } = cleanupOptions(options);
  let removed = 0;
  let lastFingerprint: string | null = null;
  for (let batch = 0; batch <= maxRemoveBatches; batch += 1) {
    const listed = await storageRpc(client, "list_account_project_storage_objects", {
      p_owner_id: userId,
      p_limit: STORAGE_BATCH_SIZE,
    });
    if (listed.error || !Array.isArray(listed.data)) {
      throw cleanupError("account_project_storage_ownership_lookup_failed");
    }
    if (listed.data.length === 0) return { complete: true, removed };
    if (batch === maxRemoveBatches) return { complete: false, removed };
    const entries = listed.data.map((row) => {
      try {
        if (row.owner_id !== userId && row.owner_id !== null) throw new Error("owner_mismatch");
        const { path, parts } = validateStorageObjectPath(row.name);
        if (!UUID.test(parts[0] ?? "")) throw new Error("project_prefix_invalid");
        return { bucket: PROJECT_FILE_BUCKET, path, ownerId: row.owner_id };
      } catch {
        throw cleanupError("account_project_storage_ownership_invalid");
      }
    });
    const referenced = await externallyReferencedProjectObjects(client, entries, new Set(), userId);
    // Legacy caller uploads cannot remain owned by the departing Auth user.
    // Preserve authorized collaborator bytes in a verified service-owned copy
    // before the usual retirement/removal pass. Limit heavy copies per request.
    const transferred = new Set<string>();
    const retainedOwned = entries.filter(
      (entry) => entry.ownerId === userId && referenced.has(`${entry.bucket}:${entry.path}`),
    );
    for (const entry of retainedOwned.slice(0, 2)) {
      if (await transferRetainedAccountSource(client, userId, entry.path))
        transferred.add(entry.path);
    }
    const candidates = entries
      .filter(
        (entry) => transferred.has(entry.path) || !referenced.has(`${entry.bucket}:${entry.path}`),
      )
      .map((entry) => entry.path);
    const retained = await claimProjectStorageSourceCleanup(client, null, candidates, [], userId);
    const paths = candidates.filter((path) => !retained.has(path));
    if (paths.length === 0) {
      // An active transfer lease or another deletion remains retryable. Bytes
      // and Auth ownership stay intact until a verified copy can be rebound.
      return { complete: false, removed };
    }
    const fingerprint = paths.join("\0");
    if (fingerprint === lastFingerprint) {
      throw cleanupError("account_project_storage_cleanup_unverified");
    }
    const result = await client.storage.from(PROJECT_FILE_BUCKET).remove(paths);
    if (result.error) throw cleanupError("account_project_storage_remove_failed");
    const settled = await storageRpc(client, "settle_account_project_storage_charges", {
      p_paths: paths,
    });
    if (settled.error || settled.data !== true)
      throw cleanupError("account_project_storage_settlement_failed");
    removed += paths.length;
    lastFingerprint = fingerprint;
    if (retainedOwned.length > 0) return { complete: false, removed };
  }
  return { complete: false, removed };
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

async function cleanupOwnedProjectFiles(
  client: AccountStorageClient,
  userId: string,
  options: { maxRemoveBatches?: number } = {},
): Promise<StorageCleanupProgress> {
  const { maxRemoveBatches } = cleanupOptions(options);
  let removed = 0;

  for (let batch = 0; batch < maxRemoveBatches; batch += 1) {
    let listed = await projectFiles(client)
      .select("id,project_id,storage_path,uploaded_by,kind,status,delete_attempt_id")
      .eq("uploaded_by", userId)
      .order("id", { ascending: true })
      .limit(STORAGE_BATCH_SIZE);
    if (listed.error || !Array.isArray(listed.data)) {
      throw cleanupError("account_project_storage_list_failed");
    }
    // Deleting an owner cascades every Project row, including metadata for
    // objects uploaded by collaborators. Fetch those rows through an inner
    // owner join so their bytes are removed before the cascade erases the only
    // Storage paths that identify them.
    if (listed.data.length === 0) {
      listed = await projectFiles(client)
        .select(
          "id,project_id,storage_path,uploaded_by,kind,status,delete_attempt_id,projects!inner(owner_id)",
        )
        .eq("projects.owner_id", userId)
        .order("id", { ascending: true })
        .limit(STORAGE_BATCH_SIZE);
      if (listed.error || !Array.isArray(listed.data)) {
        throw cleanupError("account_project_storage_list_failed");
      }
    }
    if (listed.data.length === 0) return { complete: true, removed };

    // Claim every lifecycle row before removing bytes. A failed/active claim
    // leaves the remaining metadata and quota intact for a bounded retry.
    const claims = new Map<string, string>();
    for (const row of listed.data) {
      if (row.status === undefined) continue;
      const claimed = await storageRpc(client, "claim_account_project_file_cleanup", {
        p_user_id: userId,
        p_file_id: row.id,
        p_attempt_id: crypto.randomUUID(),
      });
      const value =
        claimed.data && typeof claimed.data === "object" && !Array.isArray(claimed.data)
          ? (claimed.data as Record<string, unknown>)
          : null;
      if (claimed.error || !value) throw cleanupError("account_project_storage_claim_failed");
      if (value.state === "busy") return { complete: false, removed };
      if (
        value.state !== "claimed" ||
        value.id !== row.id ||
        value.storage_path !== row.storage_path ||
        typeof value.delete_attempt_id !== "string"
      ) {
        throw cleanupError("account_project_storage_claim_invalid");
      }
      claims.set(String(row.id), value.delete_attempt_id);
      // Attempt-specific objects are not canonical metadata paths, but are
      // durable under the reserved file folder and must be removed first.
      const { purgeProjectUploadAttemptFolder } = await import("./project-deletion-policy.mjs");
      await purgeProjectUploadAttemptFolder({
        storage: client.storage.from(PROJECT_FILE_BUCKET) as never,
        projectId: String(row.project_id),
        fileId: String(row.id),
      });
    }

    const associations = await loadProjectFileAssociations(client, listed.data);
    let entries: Array<ReturnType<typeof resolveProjectFileStorage>>;
    try {
      entries = listed.data.map((row) =>
        resolveProjectFileStorage(
          row as StorageReferenceRow,
          typeof row.id === "string" ? associations.get(row.id) : undefined,
        ),
      );
    } catch {
      throw cleanupError("account_project_storage_entry_invalid");
    }
    const deletingIds = new Set(entries.map((entry) => entry.id));
    const externallyReferenced = await externallyReferencedProjectObjects(
      client,
      entries,
      deletingIds,
      userId,
    );
    const retained = await claimProjectStorageSourceCleanup(
      client,
      null,
      entries.filter((entry) => entry.bucket === PROJECT_FILE_BUCKET).map((entry) => entry.path),
      [...deletingIds],
      userId,
    );
    retained.forEach((path) => externallyReferenced.add(`${PROJECT_FILE_BUCKET}:${path}`));
    const byBucket = new Map<string, string[]>();
    for (const entry of entries) {
      // Project source bytes are collectible when their final live reference
      // disappears, including a promoted row preserved by an earlier deletion.
      // Agent evidence remains owned by its user prefix and is cleaned below.
      if (
        entry.bucket !== PROJECT_FILE_BUCKET ||
        externallyReferenced.has(`${entry.bucket}:${entry.path}`)
      ) {
        continue;
      }
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
    const legacyIds = entries.filter((entry) => !claims.has(entry.id)).map((entry) => entry.id);
    if (legacyIds.length > 0) {
      const deleted = await projectFiles(client).delete().in("id", legacyIds);
      if (deleted.error) throw cleanupError("account_project_metadata_cleanup_failed");
    }
    for (const [fileId, attemptId] of claims) {
      const finalized = await storageRpc(client, "finalize_account_project_file_cleanup", {
        p_user_id: userId,
        p_file_id: fileId,
        p_attempt_id: attemptId,
        p_storage_removed: entries.some(
          (entry) =>
            entry.id === fileId &&
            entry.bucket === PROJECT_FILE_BUCKET &&
            !externallyReferenced.has(`${entry.bucket}:${entry.path}`),
        ),
      });
      if (
        finalized.error ||
        !finalized.data ||
        typeof finalized.data !== "object" ||
        !("deleted" in finalized.data) ||
        finalized.data.deleted !== true
      ) {
        throw cleanupError("account_project_metadata_cleanup_failed");
      }
    }
    removed += entries.length;
  }

  const remaining = await projectFiles(client)
    .select("id,project_id,storage_path,uploaded_by,kind,status,delete_attempt_id")
    .eq("uploaded_by", userId)
    .order("id", { ascending: true })
    .limit(1);
  if (remaining.error || !Array.isArray(remaining.data)) {
    throw cleanupError("account_project_storage_list_failed");
  }
  if (remaining.data.length > 0) return { complete: false, removed };
  const ownedProjectRemaining = await projectFiles(client)
    .select(
      "id,project_id,storage_path,uploaded_by,kind,status,delete_attempt_id,projects!inner(owner_id)",
    )
    .eq("projects.owner_id", userId)
    .order("id", { ascending: true })
    .limit(1);
  if (ownedProjectRemaining.error || !Array.isArray(ownedProjectRemaining.data)) {
    throw cleanupError("account_project_storage_list_failed");
  }
  return { complete: ownedProjectRemaining.data.length === 0, removed };
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

  const unregistered = await cleanupUnregisteredOwnedProjectObjects(client, userId, options);
  const projectRemoved = projectFiles.removed + unregistered.removed;
  if (!unregistered.complete) return { complete: false, removed: projectRemoved };

  const evidence = await clearStoragePrefix(
    client.storage.from(AGENT_EVIDENCE_BUCKET),
    userId,
    options,
  );
  if (!evidence.complete) {
    return { complete: false, removed: projectRemoved + evidence.removed };
  }

  const library = await clearStoragePrefix(
    client.storage.from(LIBRARY_IMAGE_BUCKET),
    userId,
    options,
  );
  return {
    complete: library.complete,
    removed: projectRemoved + evidence.removed + library.removed,
  };
}
