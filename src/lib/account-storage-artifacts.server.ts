import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Result = { data?: unknown; error: unknown };
type RpcResult = PromiseLike<Result> & { abortSignal(signal: AbortSignal): PromiseLike<Result> };
export type StorageArtifactClient = {
  rpc(name: string, args: Record<string, unknown>): RpcResult;
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<Result> } };
};
export type StorageArtifactReservation = {
  generation: string;
  ownerId: string;
  requesterId: string;
  bucket: "library-images" | "project-files" | "library-files";
  path: string;
};
const admin = supabaseAdmin as unknown as StorageArtifactClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validArtifact(value: StorageArtifactReservation): boolean {
  return (
    UUID.test(value.generation) &&
    UUID.test(value.ownerId) &&
    UUID.test(value.requesterId) &&
    (value.bucket === "library-images" ||
      value.bucket === "project-files" ||
      value.bucket === "library-files") &&
    value.path.length <= 512 &&
    /^[A-Za-z0-9_./-]+$/u.test(value.path) &&
    value.path.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
    UUID.test(value.path.split("/")[0]) &&
    value.path.includes(value.generation) &&
    (value.bucket !== "library-images" ||
      (value.ownerId === value.requesterId &&
        value.path.startsWith(`${value.ownerId}/${value.generation}.`) &&
        /\.(?:png|jpg|jpeg|webp|gif)$/u.test(value.path))) &&
    (value.bucket !== "library-files" ||
      (value.ownerId === value.requesterId &&
        value.path.startsWith(`${value.ownerId}/${value.generation}.`) &&
        /\.(?:pdf|docx|xlsx|pptx)$/u.test(value.path)))
  );
}

async function bounded<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeout = 10_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("account_storage_artifact_unavailable"));
        }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(client: StorageArtifactClient, name: string, args: Record<string, unknown>) {
  const result = await bounded((signal) => client.rpc(name, args).abortSignal(signal));
  if (result.error) throw new Error("account_storage_artifact_unavailable");
  return result.data;
}

/** Call before any Storage write. Failure means no upload is authorized. */
export async function reserveAccountStorageArtifact(
  artifact: StorageArtifactReservation,
  client = admin,
): Promise<void> {
  if (!validArtifact(artifact)) throw new Error("account_storage_artifact_invalid");
  const result = await rpc(client, "reserve_account_storage_artifact", {
    p_generation: artifact.generation,
    p_owner_id: artifact.ownerId,
    p_requester_id: artifact.requesterId,
    p_bucket: artifact.bucket,
    p_storage_path: artifact.path,
  });
  if (result !== true) throw new Error("account_storage_artifact_not_reserved");
}

/** The caller must compensate its own metadata and bytes if publication is refused. */
export async function settleAccountStorageArtifact(
  artifact: StorageArtifactReservation,
  client = admin,
): Promise<boolean> {
  if (!validArtifact(artifact)) throw new Error("account_storage_artifact_invalid");
  const result = await rpc(client, "settle_account_storage_artifact", {
    p_generation: artifact.generation,
    p_owner_id: artifact.ownerId,
    p_requester_id: artifact.requesterId,
    p_bucket: artifact.bucket,
    p_storage_path: artifact.path,
  });
  if (typeof result !== "boolean") throw new Error("account_storage_artifact_unavailable");
  return result;
}

export async function retireAccountStorageArtifact(
  artifact: StorageArtifactReservation,
  client = admin,
): Promise<void> {
  if (!validArtifact(artifact)) throw new Error("account_storage_artifact_invalid");
  await rpc(client, "retire_account_storage_artifact", {
    p_generation: artifact.generation,
    p_owner_id: artifact.ownerId,
    p_requester_id: artifact.requesterId,
    p_bucket: artifact.bucket,
    p_storage_path: artifact.path,
  });
}

/** Idempotent, bounded, repeated cleanup; a successful empty sweep never forgets a path. */
export async function sweepAccountStorageArtifacts(
  userId?: string,
  client = admin,
): Promise<number> {
  if (userId !== undefined && !UUID.test(userId))
    throw new Error("account_storage_artifact_invalid");
  const rows = await rpc(client, "claim_account_storage_artifact_cleanup", {
    p_user_id: userId ?? null,
    p_limit: 25,
  });
  if (!Array.isArray(rows) || rows.length > 25)
    throw new Error("account_storage_artifact_unavailable");
  let removed = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("account_storage_artifact_invalid");
    const artifact = {
      generation: row.generation,
      ownerId: row.owner_id,
      requesterId: row.requester_id,
      bucket: row.bucket,
      path: row.storage_path,
    } as StorageArtifactReservation;
    if (
      typeof artifact.path !== "string" ||
      !validArtifact(artifact) ||
      row.state !== "retired" ||
      (userId !== undefined && artifact.ownerId !== userId && artifact.requesterId !== userId)
    ) {
      throw new Error("account_storage_artifact_invalid");
    }
    const result = await bounded(
      () => client.storage.from(artifact.bucket).remove([artifact.path]),
      30_000,
    );
    if (result.error) throw new Error("account_storage_artifact_cleanup_failed");
    const recorded = await rpc(client, "record_account_storage_artifact_cleanup", {
      p_generation: artifact.generation,
    });
    if (recorded !== true) throw new Error("account_storage_artifact_cleanup_failed");
    removed += 1;
  }
  return removed;
}

/** An existing account-deletion fence is required; live upload leases remain retryable. */
export async function prepareAccountStorageArtifactDeletion(
  userId: string,
  client = admin,
): Promise<boolean> {
  if (!UUID.test(userId)) throw new Error("account_storage_artifact_invalid");
  const args = { p_user_id: userId };
  const before = await rpc(client, "prepare_account_storage_artifact_deletion", args);
  if (typeof before !== "boolean") throw new Error("account_storage_artifact_unavailable");
  await sweepAccountStorageArtifacts(userId, client);
  const after = await rpc(client, "prepare_account_storage_artifact_deletion", args);
  if (typeof after !== "boolean") throw new Error("account_storage_artifact_unavailable");
  return after;
}

/** Retire original-file publications, sweep their objects, then release metadata and quota. */
export async function prepareLibraryOriginalDeletion(
  userId: string,
  client = admin,
): Promise<boolean> {
  if (!UUID.test(userId)) throw new Error("account_storage_artifact_invalid");
  const args = { p_owner: userId };
  const before = await rpc(client, "prepare_library_file_account_deletion", args);
  if (typeof before !== "boolean") throw new Error("account_storage_artifact_unavailable");
  await sweepAccountStorageArtifacts(userId, client);
  const after = await rpc(client, "prepare_library_file_account_deletion", args);
  if (typeof after !== "boolean") throw new Error("account_storage_artifact_unavailable");
  return after;
}
