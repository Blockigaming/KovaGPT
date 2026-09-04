export const AGENT_EVIDENCE_BUCKET = "agent-evidence";
export const PROJECT_FILE_BUCKET = "project-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_BUCKETS = new Set([AGENT_EVIDENCE_BUCKET, PROJECT_FILE_BUCKET]);

function invalid() {
  const error = new Error("project_file_storage_reference_invalid");
  error.name = "ProjectFileStorageReferenceError";
  return error;
}

function validUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

export function validateStorageObjectPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\\")
  ) {
    throw invalid();
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw invalid();
  return { path: value, parts };
}

export function parseAgentStorageReference(value) {
  if (typeof value !== "string" || value.length > 1_040) throw invalid();
  const separator = value.indexOf(":");
  if (separator < 1) throw invalid();
  const bucket = value.slice(0, separator);
  if (!ALLOWED_BUCKETS.has(bucket)) throw invalid();
  const { path, parts } = validateStorageObjectPath(value.slice(separator + 1));
  return { bucket, path, parts };
}

/**
 * Resolves the real Storage bucket for a project_files row. Promotions retain
 * only their source path in project_files, so the promotion + deliverable pair
 * is authoritative for distinguishing agent-evidence from cross-project
 * project-files references.
 */
export function resolveProjectFileStorage(row, association = null) {
  if (!row || !validUuid(row.id) || !validUuid(row.project_id) || !validUuid(row.uploaded_by)) {
    throw invalid();
  }
  const stored = validateStorageObjectPath(row.storage_path);

  if (!association) {
    if (row.kind === "agent-deliverable" || stored.parts[0] !== row.project_id) throw invalid();
    return {
      id: row.id,
      bucket: PROJECT_FILE_BUCKET,
      path: stored.path,
      source: "canonical",
      sourceProjectId: row.project_id,
      sourceOwnerId: null,
    };
  }

  const { promotion, deliverable } = association;
  if (
    row.kind !== "agent-deliverable" ||
    !promotion ||
    !deliverable ||
    !validUuid(promotion.id) ||
    promotion.destination_id !== row.id ||
    promotion.destination_type !== "project_file" ||
    promotion.status !== "completed" ||
    promotion.project_id !== row.project_id ||
    promotion.owner_id !== row.uploaded_by ||
    !validUuid(promotion.deliverable_id) ||
    deliverable.id !== promotion.deliverable_id ||
    deliverable.owner_id !== promotion.owner_id
  ) {
    throw invalid();
  }

  const source = parseAgentStorageReference(deliverable.storage_reference);
  if (source.path !== stored.path) throw invalid();
  if (source.bucket === AGENT_EVIDENCE_BUCKET && source.parts[0] !== deliverable.owner_id) {
    throw invalid();
  }
  if (source.bucket === PROJECT_FILE_BUCKET && !validUuid(source.parts[0])) throw invalid();

  return {
    id: row.id,
    bucket: source.bucket,
    path: source.path,
    source: "promoted",
    sourceProjectId: source.bucket === PROJECT_FILE_BUCKET ? source.parts[0] : null,
    sourceOwnerId: deliverable.owner_id,
  };
}
