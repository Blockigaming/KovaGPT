// These URLs identify resources, not permissions. The receiving route must
// authenticate the cookie and repeat the database and Storage checks.
import { parseAgentStorageReference } from "./project-file-storage-policy.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[0-9a-f]{64}$/u;
export const PRIVATE_PROJECT_COLUMNS =
  "id,project_id,name,storage_path,mime_type,size_bytes,kind,status,content_sha256";
export const PRIVATE_DELIVERABLE_COLUMNS =
  "id,owner_id,title,storage_reference,mime_type,status,revision,integrity_hash";
export const PRIVATE_EXPORT_COLUMNS =
  "id,user_id,status,expires_at,size_bytes,storage_path,content_sha256";
export const PRIVATE_EVIDENCE_COLUMNS = "id,job_id,event_type,payload";
const invalid = () => {
  throw new Error("private_file_unavailable");
};
const path = (value) => {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    /[\x00-\x1f\x7f\\?#%]/u.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    invalid();
  return value;
};
const size = (value, max) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) invalid();
  return value;
};
const name = (value) => {
  if (typeof value !== "string" || !value || value.length > 500 || /[\x00-\x1f\x7f]/u.test(value))
    invalid();
  return value;
};
export function validPrivateResourceId(kind, id) {
  return (
    typeof id === "string" &&
    (kind === "evidence"
      ? /^[1-9][0-9]{0,15}$/u.test(id) && Number.isSafeInteger(Number(id))
      : ["project", "deliverable", "export"].includes(kind) && UUID.test(id))
  );
}
export function privateFileDescriptor(kind, owner, row, now = Date.now()) {
  if (
    !UUID.test(owner ?? "") ||
    !row ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    !validPrivateResourceId(kind, String(row.id))
  )
    invalid();
  let descriptor;
  if (kind === "project") {
    if (
      row.status !== "ready" ||
      !UUID.test(row.project_id ?? "") ||
      !["file", "image"].includes(row.kind)
    )
      invalid();
    const storagePath = path(row.storage_path);
    if (!storagePath.startsWith(`${row.project_id}/`)) invalid();
    if (row.content_sha256 !== null && !HASH.test(row.content_sha256 ?? "")) invalid();
    descriptor = {
      bucket: "project-files",
      path: storagePath,
      name: name(row.name),
      mime: row.mime_type,
      size: size(row.size_bytes, 10 * 1024 * 1024),
      sha256: row.content_sha256,
      maxBytes: 10 * 1024 * 1024,
      image: row.kind === "image",
      scope: row.project_id,
      revision: null,
      expiresAt: null,
    };
  } else if (kind === "deliverable") {
    if (
      row.owner_id !== owner ||
      !["draft", "ready", "superseded"].includes(row.status) ||
      !HASH.test(row.integrity_hash ?? "") ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1
    )
      invalid();
    const reference = parseAgentStorageReference(row.storage_reference);
    const storagePath = path(reference.path);
    if (reference.bucket === "agent-evidence" && !storagePath.startsWith(`${owner}/`)) invalid();
    descriptor = {
      bucket: reference.bucket,
      path: storagePath,
      name: name(row.title),
      mime: row.mime_type,
      size: null,
      sha256: row.integrity_hash,
      maxBytes: 10 * 1024 * 1024,
      image: false,
      scope: owner,
      revision: row.revision,
      expiresAt: null,
    };
  } else if (kind === "evidence") {
    if (!UUID.test(row.job_id ?? "")) invalid();
    const storagePath = path(row.payload?.storage_path);
    if (!storagePath.startsWith(`${owner}/`)) invalid();
    const lower = storagePath.toLowerCase();
    const evidenceType =
      lower.endsWith(".png")
        ? { name: `evidence-${row.id}.png`, mime: "image/png", image: true }
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? { name: `evidence-${row.id}.jpg`, mime: "image/jpeg", image: true }
          : lower.endsWith(".json")
            ? { name: `evidence-${row.id}.json`, mime: "application/json", image: false }
            : lower.endsWith(".txt")
              ? { name: `evidence-${row.id}.txt`, mime: "text/plain", image: false }
              : null;
    if (!evidenceType) invalid();
    descriptor = {
      bucket: "agent-evidence",
      path: storagePath,
      name: evidenceType.name,
      mime: evidenceType.mime,
      size: null,
      sha256: null,
      maxBytes: 10 * 1024 * 1024,
      image: evidenceType.image,
      scope: row.job_id,
      revision: null,
      expiresAt: null,
    };
  } else if (kind === "export") {
    if (
      row.user_id !== owner ||
      row.status !== "complete" ||
      !HASH.test(row.content_sha256 ?? "") ||
      typeof row.expires_at !== "string" ||
      !Number.isFinite(Date.parse(row.expires_at)) ||
      Date.parse(row.expires_at) <= now
    )
      invalid();
    const storagePath = path(row.storage_path),
      parts = storagePath.split("/");
    if (
      parts.length !== 3 ||
      parts[0] !== owner ||
      parts[1] !== row.id ||
      !parts[2].endsWith(".json") ||
      !UUID.test(parts[2].slice(0, -5))
    )
      invalid();
    descriptor = {
      bucket: "account-exports",
      path: storagePath,
      name: "kovagpt-account-export.json",
      mime: "application/json",
      size: size(row.size_bytes, 50 * 1024 * 1024),
      sha256: row.content_sha256,
      maxBytes: 50 * 1024 * 1024,
      image: false,
      scope: owner,
      revision: null,
      expiresAt: row.expires_at,
    };
  } else invalid();
  if (
    descriptor.mime !== null &&
    (typeof descriptor.mime !== "string" ||
      descriptor.mime.length > 100 ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu.test(descriptor.mime))
  )
    invalid();
  return { kind, id: String(row.id), owner, status: row.status ?? null, ...descriptor };
}
export async function privateFileVersion(descriptor) {
  const bytes = new TextEncoder().encode(JSON.stringify(descriptor));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
export async function ownedPrivateFileLink(kind, owner, row) {
  const descriptor = privateFileDescriptor(kind, owner, row);
  const query = new URLSearchParams({
    kind,
    id: descriptor.id,
    owner,
    version: await privateFileVersion(descriptor),
  });
  return `/api/private-files?${query}`;
}
