import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { waitForPromiseWithSignal } from "./ai/provider-transport.server.mjs";
import {
  LIBRARY_ORIGINAL_BUCKET,
  LIBRARY_ORIGINAL_MAX_BYTES,
  LibraryOriginalError,
  originalDocumentSha256,
  validateOriginalDocument,
  validateOriginalRecord,
} from "./library-original-policy.mjs";
async function rpc(admin, name, args, signal) {
  const result = await waitForPromiseWithSignal(admin.rpc(name, args).abortSignal(signal), signal);
  if (result.error) {
    const code = result.error.message;
    if (code === "library_file_count_limit")
      throw new LibraryOriginalError(
        "Library can retain up to 1,000 original documents. Remove an original file and try again.",
        429,
      );
    if (code === "library_upload_limit" || code === "library_storage_limit")
      throw new LibraryOriginalError(
        code === "library_upload_limit"
          ? "Your daily upload limit has been reached."
          : "Your account storage limit has been reached.",
        429,
      );
    throw new LibraryOriginalError();
  }
  return result.data;
}
async function readBytes(admin, row, signal, { supabaseUrl, fetchImpl = fetch }) {
  const signed = await waitForPromiseWithSignal(
    admin.storage.from(LIBRARY_ORIGINAL_BUCKET).createSignedUrl(row.storage_path, 30),
    signal,
  );
  if (signed.error || !signed.data?.signedUrl) throw new LibraryOriginalError();
  let url, base;
  try {
    url = new URL(signed.data.signedUrl);
    base = new URL(supabaseUrl);
  } catch {
    throw new LibraryOriginalError();
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    decodeURIComponent(url.pathname) !==
      `/storage/v1/object/sign/${LIBRARY_ORIGINAL_BUCKET}/${row.storage_path}`
  )
    throw new LibraryOriginalError();
  const result = await waitForPromiseWithSignal(
    fetchImpl(url.href, { signal, redirect: "error", credentials: "omit", cache: "no-store" }),
    signal,
  );
  if (!result.ok) {
    void result.body?.cancel().catch(() => undefined);
    throw new LibraryOriginalError();
  }
  const bytes = await readResponseBytesBounded(result, LIBRARY_ORIGINAL_MAX_BYTES, {
    signal,
    timeoutMs: 10000,
  });
  if (bytes.length !== row.size_bytes || (await originalDocumentSha256(bytes)) !== row.sha256)
    throw new LibraryOriginalError();
  return bytes;
}
export async function publishOriginalLibraryDocument(
  admin,
  owner,
  input,
  { storageLimit, signal, expectedGeneration, ...transport },
) {
  const document = validateOriginalDocument(input),
    sha = await originalDocumentSha256(document.bytes);
  const value = await rpc(
    admin,
    expectedGeneration ? "reserve_library_file_replacement" : "reserve_library_file_upload",
    {
      p_owner: owner,
      ...(expectedGeneration ? { p_expected_generation: expectedGeneration } : {}),
      p_id: document.id,
      p_generation: crypto.randomUUID(),
      p_name: document.name,
      p_mime: document.contentType,
      p_size: document.bytes.length,
      p_sha256: sha,
      p_text: document.text,
      p_storage_limit: storageLimit,
    },
    signal,
  );
  const row = validateOriginalRecord(value, owner, document.id);
  if (row.sha256 !== sha || row.size_bytes !== document.bytes.length)
    throw new LibraryOriginalError();
  if (row.state === "ready") {
    const current = await rpc(
      admin,
      "read_library_file",
      { p_owner: owner, p_id: row.id, p_generation: row.generation },
      signal,
    );
    validateOriginalRecord(current, owner, row.id, row.generation);
    return { id: row.id, generation: row.generation };
  }
  try {
    if (row.state !== "pending") throw new LibraryOriginalError();
    await waitForPromiseWithSignal(
      admin.storage.from(LIBRARY_ORIGINAL_BUCKET).upload(row.storage_path, document.bytes, {
        contentType: document.contentType,
        upsert: false,
      }),
      signal,
    );
    // A concurrent identical retry may already have written these immutable bytes.
    // Verify the stored digest before settlement, including upload-conflict responses.
    await readBytes(admin, row, signal, transport);
    const settled = await rpc(
      admin,
      expectedGeneration ? "settle_library_file_replacement" : "settle_library_file_upload",
      { p_owner: owner, p_id: row.id, p_generation: row.generation },
      signal,
    );
    if (settled !== true) throw new LibraryOriginalError();
    return { id: row.id, generation: row.generation };
  } catch (error) {
    // A lost settlement response may already have published. The DB refuses to
    // retire a ready row for a failed producer; retries use the same input ID.
    await rpc(
      admin,
      expectedGeneration ? "retire_library_file_replacement" : "retire_library_file",
      {
        p_owner: owner,
        p_id: row.id,
        p_generation: row.generation,
        ...(expectedGeneration ? {} : { p_delete: false }),
      },
      AbortSignal.timeout(10000),
    ).catch(() => undefined);
    throw error instanceof LibraryOriginalError ? error : new LibraryOriginalError();
  }
}
export async function downloadOriginalLibraryDocument(
  admin,
  owner,
  id,
  generation,
  signal,
  transport,
) {
  const args = { p_owner: owner, p_id: id, p_generation: generation };
  const row = validateOriginalRecord(
    await rpc(admin, "read_library_file_version", args, signal),
    owner,
    id,
    generation,
  );
  const bytes = await readBytes(admin, row, signal, transport);
  const current = validateOriginalRecord(
    await rpc(admin, "read_library_file_version", args, signal),
    owner,
    id,
    generation,
  );
  if (current.sha256 !== row.sha256 || current.storage_path !== row.storage_path)
    throw new LibraryOriginalError();
  signal.throwIfAborted();
  return { row, bytes };
}
export async function deleteOriginalLibraryDocument(admin, owner, id, generation, signal) {
  const retired = await rpc(
    admin,
    "retire_library_file",
    { p_owner: owner, p_id: id, p_generation: generation, p_delete: true },
    signal,
  );
  if (retired !== true)
    throw new LibraryOriginalError("This file changed. Refresh Library before deleting it.", 409);
  // Read the service-only ledger after the generation-bound retirement; the
  // public read RPC intentionally no longer exposes deleting files.
  const found = await admin
    .from("library_file_uploads")
    .select("*")
    .eq("id", id)
    .eq("owner_id", owner)
    .eq("generation", generation)
    .abortSignal(signal)
    .maybeSingle();
  if (found.error) throw new LibraryOriginalError();
  if (
    found.data?.state === "deleted" &&
    found.data.owner_id === owner &&
    found.data.generation === generation
  )
    return { ok: true };
  const row = validateOriginalRecord(found.data, owner, id, generation);
  const removed = await waitForPromiseWithSignal(
    admin.storage.from(LIBRARY_ORIGINAL_BUCKET).remove([row.storage_path]),
    signal,
  );
  if (removed.error)
    throw new LibraryOriginalError("The original file could not be removed. Please retry.");
  if (
    (await rpc(
      admin,
      "record_account_storage_artifact_cleanup",
      { p_generation: generation },
      signal,
    )) !== true
  )
    throw new LibraryOriginalError();
  return { ok: true };
}
