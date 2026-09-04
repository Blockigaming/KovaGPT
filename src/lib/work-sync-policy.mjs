export const WORK_SYNC_MAX_BODY_BYTES = 128 * 1024;
export const WORK_SYNC_MAX_PAYLOAD_BYTES = 96 * 1024;
export const WORK_SYNC_MAX_PAYLOAD_DEPTH = 16;
export const WORK_SYNC_MAX_CHANGES = 500;
export const WORK_SYNC_READ_RATE_POLICY = Object.freeze({
  action: "work_sync_read",
  limit: 60,
  windowSeconds: 60,
});
export const WORK_SYNC_MUTATION_RATE_POLICY = Object.freeze({
  action: "work_sync_mutation",
  limit: 12,
  windowSeconds: 60,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAVED_KINDS = new Set(["task", "template", "agent_draft"]);
const RECENT_TYPES = new Set(["run", "task", "template", "agent_draft"]);

export class WorkSyncInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkSyncInputError";
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields) {
  const allowed = new Set(fields);
  return Object.keys(value).every((key) => allowed.has(key));
}

function uuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new WorkSyncInputError(code);
  return value.toLowerCase();
}

function revision(value, { optional = false } = {}) {
  if (optional && value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkSyncInputError("work_sync_revision_invalid");
  }
  return value;
}

function safePayload(value) {
  if (!isRecord(value)) throw new WorkSyncInputError("work_sync_payload_invalid");
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new WorkSyncInputError("work_sync_payload_invalid");
  }
  if (!text || new TextEncoder().encode(text).byteLength > WORK_SYNC_MAX_PAYLOAD_BYTES) {
    throw new WorkSyncInputError("work_sync_payload_too_large");
  }
  const pending = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    const isArray = Array.isArray(entry.value);
    const isObject = isRecord(entry.value);
    if (!isArray && !isObject) continue;
    if (entry.depth > WORK_SYNC_MAX_PAYLOAD_DEPTH) {
      throw new WorkSyncInputError("work_sync_payload_too_deep");
    }
    if (isArray) {
      for (const child of entry.value) pending.push({ value: child, depth: entry.depth + 1 });
    } else {
      for (const child of Object.values(entry.value)) {
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  return value;
}

function title(value) {
  if (typeof value !== "string") throw new WorkSyncInputError("work_sync_title_invalid");
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > 160 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new WorkSyncInputError("work_sync_title_invalid");
  }
  return normalized;
}

export function parseWorkSyncMutation(value) {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new WorkSyncInputError("work_sync_request_invalid");
  }
  const mutationId = uuid(value.mutationId, "work_sync_mutation_id_invalid");
  if (value.action === "save") {
    if (
      !exactFields(value, [
        "action",
        "mutationId",
        "id",
        "kind",
        "title",
        "payload",
        "expectedRevision",
      ]) ||
      typeof value.kind !== "string" ||
      !SAVED_KINDS.has(value.kind)
    ) {
      throw new WorkSyncInputError("work_sync_save_invalid");
    }
    return {
      action: "save",
      mutationId,
      id: uuid(value.id, "work_sync_record_id_invalid"),
      kind: value.kind,
      title: title(value.title),
      payload: safePayload(value.payload),
      expectedRevision: revision(value.expectedRevision),
    };
  }
  if (value.action === "delete") {
    if (!exactFields(value, ["action", "mutationId", "id", "expectedRevision"])) {
      throw new WorkSyncInputError("work_sync_delete_invalid");
    }
    return {
      action: "delete",
      mutationId,
      id: uuid(value.id, "work_sync_record_id_invalid"),
      expectedRevision: revision(value.expectedRevision),
    };
  }
  if (value.action === "recent") {
    if (
      !exactFields(value, [
        "action",
        "mutationId",
        "resourceType",
        "resourceId",
        "pin",
        "expectedRevision",
      ]) ||
      typeof value.resourceType !== "string" ||
      !RECENT_TYPES.has(value.resourceType) ||
      !["keep", "pin", "unpin", "forget"].includes(value.pin)
    ) {
      throw new WorkSyncInputError("work_sync_recent_invalid");
    }
    const expectedRevision = revision(value.expectedRevision, { optional: true });
    if (value.pin !== "keep" && expectedRevision === null) {
      throw new WorkSyncInputError("work_sync_revision_invalid");
    }
    return {
      action: "recent",
      mutationId,
      resourceType: value.resourceType,
      resourceId: uuid(value.resourceId, "work_sync_resource_id_invalid"),
      pin: value.pin,
      expectedRevision,
    };
  }
  throw new WorkSyncInputError("work_sync_action_invalid");
}

export function parseWorkSyncQuery(urlValue) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  if ([...url.searchParams.keys()].some((key) => !["cursor", "limit"].includes(key))) {
    throw new WorkSyncInputError("work_sync_query_invalid");
  }
  if (url.searchParams.getAll("cursor").length > 1 || url.searchParams.getAll("limit").length > 1) {
    throw new WorkSyncInputError("work_sync_query_invalid");
  }
  const rawCursor = url.searchParams.get("cursor") ?? "0";
  const rawLimit = url.searchParams.get("limit") ?? "200";
  if (!/^(0|[1-9]\d*)$/u.test(rawCursor) || !/^[1-9]\d*$/u.test(rawLimit)) {
    throw new WorkSyncInputError("work_sync_query_invalid");
  }
  const cursor = Number(rawCursor);
  const limit = Number(rawLimit);
  if (
    !Number.isSafeInteger(cursor) ||
    !Number.isSafeInteger(limit) ||
    limit > WORK_SYNC_MAX_CHANGES
  ) {
    throw new WorkSyncInputError("work_sync_query_invalid");
  }
  return { cursor, limit };
}

export function workSyncErrorStatus(code) {
  if (code === "P0003") return 429;
  if (code === "54000") return 409;
  if (code === "40001") return 409;
  if (code === "P0002") return 404;
  if (code === "22023" || code === "23514") return 400;
  if (code === "23505") return 409;
  return 503;
}
