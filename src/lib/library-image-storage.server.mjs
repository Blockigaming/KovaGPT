import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { waitForPromiseWithSignal } from "./ai/provider-transport.server.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BUCKET = "library-images",
  MAX_BYTES = 8388608;
function failure() {
  return new Error("Library image could not be completed. Please retry.");
}
async function rpc(admin, name, args, signal) {
  signal.throwIfAborted();
  const query = admin.rpc(name, args);
  const result = await waitForPromiseWithSignal(
    typeof query.abortSignal === "function" ? query.abortSignal(signal) : query,
    signal,
  );
  if (result.error) {
    if (result.error.message === "library_storage_limit")
      throw new Error("Your account storage limit has been reached.");
    if (result.error.message === "library_image_count_limit")
      throw new Error("Your Library image limit has been reached.");
    throw failure();
  }
  return result.data;
}
function record(value, owner, id, managed = false) {
  if (
    !UUID.test(owner) ||
    !value ||
    typeof value !== "object" ||
    !UUID.test(value.generation) ||
    value.owner_id !== owner ||
    (id !== undefined && value.item_id !== id) ||
    typeof value.storage_path !== "string" ||
    value.storage_path.length > 1024 ||
    !value.storage_path.startsWith(`${owner}/`) ||
    value.storage_path.split("/").some((x) => !x || x === "." || x === ".." || x.includes("\\")) ||
    !Number.isSafeInteger(value.size_bytes) ||
    value.size_bytes < 1
  )
    throw failure();
  if (
    managed &&
    (value.size_bytes > MAX_BYTES ||
      !new RegExp(`^${owner}/${value.generation}\\.(png|jpg|jpeg|webp|gif)$`, "u").test(
        value.storage_path,
      ) ||
      !/^[0-9a-f]{64}$/u.test(value.sha256))
  )
    throw failure();
  return value;
}
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
async function verifyBytes(admin, row, signal, { supabaseUrl, fetchImpl = fetch }) {
  const signed = await waitForPromiseWithSignal(
    admin.storage.from(BUCKET).createSignedUrl(row.storage_path, 30),
    signal,
  );
  if (signed.error || !signed.data?.signedUrl) throw failure();
  let url, base;
  try {
    url = new URL(signed.data.signedUrl);
    base = new URL(supabaseUrl);
  } catch {
    throw failure();
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    decodeURIComponent(url.pathname) !== `/storage/v1/object/sign/${BUCKET}/${row.storage_path}`
  )
    throw failure();
  const response = await waitForPromiseWithSignal(
    fetchImpl(url.href, { signal, redirect: "error", cache: "no-store", credentials: "omit" }),
    signal,
  );
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw failure();
  }
  const bytes = await readResponseBytesBounded(response, MAX_BYTES, { signal, timeoutMs: 10000 });
  if (bytes.length !== row.size_bytes || (await digest(bytes)) !== row.sha256) throw failure();
}
export async function publishLibraryImageBytes(admin, owner, input, { signal, ...transport }) {
  if (
    !UUID.test(owner) ||
    !UUID.test(input.id) ||
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.length < 1 ||
    input.bytes.length > MAX_BYTES ||
    !/^[0-9a-f]{64}$/u.test(input.fingerprint)
  )
    throw failure();
  const sha = await digest(input.bytes);
  const row = record(
    await rpc(
      admin,
      "reserve_library_image_upload",
      {
        p_owner: owner,
        p_id: input.id,
        p_generation: crypto.randomUUID(),
        p_size: input.bytes.length,
        p_sha256: sha,
        p_mime: input.contentType,
        p_fingerprint: input.fingerprint,
      },
      signal,
    ),
    owner,
    input.id,
    true,
  );
  if (
    row.sha256 !== sha ||
    row.size_bytes !== input.bytes.length ||
    row.mime_type !== input.contentType ||
    row.save_fingerprint !== input.fingerprint
  )
    throw failure();
  if (row.state === "ready") {
    const current = record(
      await rpc(admin, "read_library_image_upload", { p_owner: owner, p_id: input.id }, signal),
      owner,
      input.id,
      true,
    );
    if (current.generation !== row.generation || current.sha256 !== sha) throw failure();
    return { id: input.id };
  }
  if (row.state !== "pending") throw failure();
  try {
    await waitForPromiseWithSignal(
      admin.storage
        .from(BUCKET)
        .upload(row.storage_path, input.bytes, { contentType: input.contentType, upsert: false }),
      signal,
    );
    // A duplicate immutable upload may return 409 after an earlier attempt
    // succeeded. Verify the actual stored bytes before either attempt settles.
    await verifyBytes(admin, row, signal, transport);
    const settled = await rpc(
      admin,
      "settle_library_image_upload",
      {
        p_owner: owner,
        p_id: input.id,
        p_generation: row.generation,
        p_fingerprint: input.fingerprint,
        p_title: input.title,
        p_prompt: input.prompt ?? null,
        p_source: input.source,
      },
      signal,
    );
    if (settled !== true) throw failure();
    return { id: input.id };
  } catch (error) {
    await rpc(
      admin,
      "retire_library_image_upload",
      { p_owner: owner, p_id: input.id, p_generation: row.generation, p_delete: false },
      AbortSignal.timeout(10000),
    ).catch(() => undefined);
    throw error instanceof Error ? error : failure();
  }
}
async function removeRecorded(admin, row, signal) {
  signal.throwIfAborted();
  const removed = await waitForPromiseWithSignal(
    admin.storage.from(BUCKET).remove([row.storage_path]),
    signal,
  );
  if (removed.error) throw failure();
  if (
    (await rpc(
      admin,
      "record_library_image_cleanup",
      { p_owner: row.owner_id, p_generation: row.generation },
      signal,
    )) !== true
  )
    throw failure();
}
export async function deletePrivateLibraryImage(admin, owner, id, contentGeneration, signal) {
  if (!UUID.test(owner) || !UUID.test(id) || !UUID.test(contentGeneration)) throw failure();
  const value = await rpc(
    admin,
    "read_library_image_upload",
    { p_owner: owner, p_id: id, p_delete: true },
    signal,
  );
  if (value === null) return false;
  const row = record(value, owner);
  const retired = await rpc(
    admin,
    "retire_library_image_upload",
    {
      p_owner: owner,
      p_id: id,
      p_generation: row.generation,
      p_delete: true,
      p_content_generation: contentGeneration,
    },
    signal,
  );
  if (retired?.shared === true) return true;
  const cleanup = record(retired, owner);
  if (
    cleanup.generation !== row.generation ||
    cleanup.storage_path !== row.storage_path ||
    cleanup.state !== "retired"
  )
    throw failure();
  await removeRecorded(admin, cleanup, signal);
  return true;
}
export async function sweepLibraryImageUploads(admin, owner, signal) {
  if (owner !== undefined && !UUID.test(owner)) throw failure();
  const rows = await rpc(
    admin,
    "claim_library_image_cleanup",
    { p_owner: owner ?? null, p_limit: 25 },
    signal,
  );
  if (!Array.isArray(rows) || rows.length > 25) throw failure();
  for (const value of rows) {
    const row = record(value, owner ?? value?.owner_id);
    if (row.state !== "retired") throw failure();
    await removeRecorded(admin, row, signal);
  }
  return rows.length;
}
export async function prepareLibraryImageAccountDeletion(admin, owner, signal) {
  if (!UUID.test(owner)) throw failure();
  const args = { p_owner: owner };
  const before = await rpc(admin, "prepare_library_image_account_deletion", args, signal);
  if (typeof before !== "boolean") throw failure();
  await sweepLibraryImageUploads(admin, owner, signal);
  const after = await rpc(admin, "prepare_library_image_account_deletion", args, signal);
  if (typeof after !== "boolean") throw failure();
  return after;
}
