import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const PAGE_SIZE = 64;
const MAX_ROWS = 100_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/iu;
const COLUMNS = "site_id,version_id,owner_id,path,mime_type,size_bytes,sha256,content_base64_bytes";
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
function fail(code = "account_export_database_unavailable") {
  const error = new Error(code);
  error.name = "AccountExportError";
  throw error;
}

/** Reserve the complete serialized Site payload before selecting any file body. */
export async function readAccountExportSiteFiles(admin, ownerId, remainingBytes) {
  if (!UUID.test(ownerId) || !Number.isSafeInteger(remainingBytes) || remainingBytes < 0)
    fail("account_export_too_large");
  const metadata = [];
  let reserved = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("kova_site_file_export_metadata")
      .select(COLUMNS)
      .eq("owner_id", ownerId)
      .order("version_id", { ascending: true })
      .order("path", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || data.length > PAGE_SIZE) fail();
    for (const entry of data) {
      if (
        !entry ||
        entry.owner_id !== ownerId ||
        !UUID.test(entry.site_id) ||
        !UUID.test(entry.version_id) ||
        typeof entry.path !== "string" ||
        entry.path.length < 1 ||
        entry.path.length > 200 ||
        typeof entry.mime_type !== "string" ||
        entry.mime_type.length > 100 ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size_bytes) ||
        entry.size_bytes < 0 ||
        entry.size_bytes > MAX_FILE_BYTES ||
        entry.content_base64_bytes !== Math.ceil(entry.size_bytes / 3) * 4
      )
        fail();
      const { content_base64_bytes: encodedBytes, ...row } = entry;
      // The surrounding empty [] already belongs to the account's baseline.
      reserved += bytes({ ...row, content_base64: "" }) + encodedBytes + (metadata.length ? 1 : 0);
      if (reserved > remainingBytes) fail("account_export_too_large");
      if (metadata.length >= MAX_ROWS) fail("account_export_row_limit_exceeded");
      metadata.push(row);
    }
    if (data.length < PAGE_SIZE) break;
  }

  // One immutable, database-bounded file (at most 2 MiB raw) per response.
  // Retirement during an export fails the job instead of publishing partial data.
  const rows = [];
  for (const row of metadata) {
    const { data, error } = await admin
      .from("kova_site_files")
      .select("content_base64")
      .eq("owner_id", ownerId)
      .eq("site_id", row.site_id)
      .eq("version_id", row.version_id)
      .eq("path", row.path)
      .maybeSingle();
    if (error || typeof data?.content_base64 !== "string") fail();
    const content = data.content_base64;
    if (content.length !== Math.ceil(row.size_bytes / 3) * 4) fail();
    const decoded = Buffer.from(content, "base64");
    if (
      decoded.length !== row.size_bytes ||
      decoded.toString("base64") !== content ||
      createHash("sha256").update(decoded).digest("hex") !== row.sha256
    )
      fail("account_export_file_integrity_failed");
    rows.push({ ...row, content_base64: content });
  }
  return rows;
}
