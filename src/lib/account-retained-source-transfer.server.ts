import { validateStorageObjectPath } from "./project-file-storage-policy.mjs";

type Result<T> = { data: T | null; error: unknown };
type Info = { id: string; version?: string | null; size?: number };
type Bucket = {
  copy(source: string, destination: string): PromiseLike<Result<unknown>>;
  download(path: string): PromiseLike<Result<Blob>>;
  info(path: string): PromiseLike<Result<Info>>;
};
export type RetainedSourceTransferClient = {
  rpc: unknown;
  storage: { from(bucket: string): unknown };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BYTES = 64 * 1024 * 1024;

async function bounded<T>(operation: PromiseLike<T>, milliseconds = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("retained_source_transfer_unavailable")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function rpc(
  client: RetainedSourceTransferClient,
  name: string,
  args: Record<string, unknown>,
) {
  if (typeof client.rpc !== "function") throw new Error("retained_source_transfer_unavailable");
  const result = await bounded(
    (
      client.rpc as (name: string, args: Record<string, unknown>) => PromiseLike<Result<unknown>>
    ).call(client, name, args),
    10_000,
  );
  if (result.error) throw new Error("retained_source_transfer_unavailable");
  return result.data;
}
async function digest(bucket: Bucket, path: string, size: number): Promise<string> {
  const result = await bounded(bucket.download(path));
  if (
    result.error ||
    !(result.data instanceof Blob) ||
    result.data.size !== size ||
    result.data.size > MAX_BYTES
  ) {
    throw new Error("retained_source_bytes_unverified");
  }
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await result.data.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** One sequential, bounded copy attempt. A timeout never authorizes a second
 * write to its path: the database retires that generation into repeated cleanup.
 * Call with the service client; publication verifies the destination has no Auth owner. */
export async function transferRetainedAccountSource(
  client: RetainedSourceTransferClient,
  ownerId: string,
  source: string,
): Promise<boolean> {
  if (!UUID.test(ownerId)) throw new Error("retained_source_transfer_invalid");
  validateStorageObjectPath(source);
  const generation = crypto.randomUUID();
  const claimed = await rpc(client, "claim_account_retained_source_transfer", {
    p_owner_id: ownerId,
    p_source_path: source,
    p_generation: generation,
  });
  if (!claimed || typeof claimed !== "object" || !("state" in claimed))
    throw new Error("retained_source_transfer_invalid");
  const row = claimed as Record<string, unknown>;
  if (row.state === "published" || row.state === "unreferenced") return true;
  if (row.state === "busy") return false;
  if (
    row.state !== "copy" ||
    row.generation !== generation ||
    row.source !== source ||
    typeof row.destination !== "string" ||
    !row.destination.startsWith(source.split("/")[0] + "/" + generation + ".") ||
    !Number.isSafeInteger(row.size) ||
    (row.size as number) < 0 ||
    (row.size as number) > MAX_BYTES
  ) {
    throw new Error("retained_source_transfer_invalid");
  }
  validateStorageObjectPath(row.destination);
  const bucket = client.storage.from("project-files") as Bucket;
  // The reservation was committed before the external API receives any bytes.
  // Never retry this copy call, including 409/timeout/ambiguous responses.
  const copied = await bounded(bucket.copy(source, row.destination));
  if (copied.error) throw new Error("retained_source_copy_failed");
  const sourceHash = await digest(bucket, source, row.size as number);
  const before = await bounded(bucket.info(row.destination));
  if (before.error || !before.data || !UUID.test(before.data.id) || before.data.size !== row.size) {
    throw new Error("retained_source_bytes_unverified");
  }
  const destinationHash = await digest(bucket, row.destination, row.size as number);
  if (sourceHash !== destinationHash) throw new Error("retained_source_bytes_unverified");
  return (
    (await rpc(client, "publish_account_retained_source_transfer", {
      p_owner_id: ownerId,
      p_generation: generation,
      p_destination_id: before.data.id,
      p_destination_version: before.data.version ?? null,
      p_sha256: sourceHash,
    })) === true
  );
}
