import {
  PROJECT_FILE_BUCKET,
  resolveProjectFileStorage,
  type StorageReferenceRow,
  type StorageReferenceAssociation,
} from "./project-file-storage-policy.mjs";

type Row = Record<string, unknown>;
type Query = {
  select(columns: string): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options: { ascending: true }): Query;
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: unknown }>;
};
type Client = { from(table: string): unknown };

async function readRows(
  client: Client,
  table: string,
  column: string,
  values: unknown[],
  columns = "*",
): Promise<Row[]> {
  const unique = [...new Set(values)];
  const rows: Row[] = [];
  for (let start = 0; start < unique.length; start += 100) {
    let complete = false;
    for (let offset = 0; offset < 10_000; offset += 1_000) {
      const result = await (client.from(table) as Query)
        .select(columns)
        .in(column, unique.slice(start, start + 100))
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (result.error || !Array.isArray(result.data))
        throw new Error("project_storage_reference_lookup_failed");
      rows.push(...result.data);
      if (result.data.length < 1_000) {
        complete = true;
        break;
      }
    }
    if (!complete) throw new Error("project_storage_reference_limit_exceeded");
  }
  return rows;
}

export async function resolveProjectStorageRows(client: Client, rows: Row[]) {
  const promotions = (
    await readRows(
      client,
      "agent_resource_promotions",
      "destination_id",
      rows.map((row) => row.id),
    )
  ).filter((row) => row.destination_type === "project_file");
  const deliverables = await readRows(
    client,
    "agent_deliverables",
    "id",
    promotions.map((row) => row.deliverable_id),
  );
  const byId = new Map(deliverables.map((row) => [row.id, row]));
  const associations = new Map<string, StorageReferenceAssociation>();
  for (const promotion of promotions) {
    if (
      typeof promotion.destination_id !== "string" ||
      associations.has(promotion.destination_id) ||
      !byId.has(promotion.deliverable_id)
    ) {
      throw new Error("project_storage_reference_invalid");
    }
    associations.set(promotion.destination_id, {
      promotion: promotion as StorageReferenceAssociation["promotion"],
      deliverable: byId.get(promotion.deliverable_id) as StorageReferenceAssociation["deliverable"],
    });
  }
  return rows.map((row) =>
    resolveProjectFileStorage(row as StorageReferenceRow, associations.get(String(row.id))),
  );
}

export async function survivingProjectStoragePaths(
  client: Client,
  deletingProjectId: string | null,
  paths: string[],
  deletingFileIds: string[] = [],
  deletingAccountUserId: string | null = null,
): Promise<Set<string>> {
  const candidates = (
    await readRows(
      client,
      "project_files",
      "storage_path",
      paths,
      "id,project_id,uploaded_by,storage_path,kind",
    )
  ).filter(
    (row) => row.project_id !== deletingProjectId && !deletingFileIds.includes(String(row.id)),
  );
  const retained = new Set(
    (await resolveProjectStorageRows(client, candidates))
      .filter((entry) => entry.bucket === PROJECT_FILE_BUCKET)
      .map((entry) => entry.path),
  );
  const deliverables = await readRows(
    client,
    "agent_deliverables",
    "storage_reference",
    paths.map((path) => `${PROJECT_FILE_BUCKET}:${path}`),
  );
  for (const row of deliverables) {
    if (row.owner_id === deletingAccountUserId || row.status === "deleted") continue;
    if (typeof row.storage_reference !== "string")
      throw new Error("project_storage_reference_invalid");
    retained.add(row.storage_reference.slice(PROJECT_FILE_BUCKET.length + 1));
  }
  return retained;
}

export async function projectFileStorageReference(client: Client, fileId: string) {
  const rows = await readRows(
    client,
    "project_files",
    "id",
    [fileId],
    "id,project_id,uploaded_by,storage_path,kind",
  );
  if (rows.length !== 1) throw new Error("project_storage_reference_invalid");
  return (await resolveProjectStorageRows(client, rows))[0]!;
}

/** Atomically retain live sources or permanently fence new references before Storage I/O. */
export async function claimProjectStorageSourceCleanup(
  client: Client & { rpc: unknown },
  deletingProjectId: string | null,
  paths: string[],
  deletingFileIds: string[] = [],
  deletingAccountUserId: string | null = null,
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  if (typeof client.rpc !== "function") throw new Error("project_storage_source_claim_unavailable");
  const unique = [...new Set(paths)];
  const result = await client.rpc.call(client, "claim_project_storage_source_cleanup", {
    p_paths: unique,
    p_project_id: deletingProjectId,
    p_account_id: deletingAccountUserId,
    p_file_ids: deletingFileIds,
  });
  if (
    result.error ||
    !Array.isArray(result.data) ||
    result.data.some((path: unknown) => typeof path !== "string" || !unique.includes(path))
  ) {
    throw new Error("project_storage_source_claim_failed");
  }
  return new Set(result.data as string[]);
}
