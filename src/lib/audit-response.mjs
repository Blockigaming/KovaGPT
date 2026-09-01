const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const isStringOrNull = (value) => value === null || typeof value === "string";

function isAuditRow(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    typeof value.action === "string" &&
    value.action.length > 0 &&
    typeof value.status === "string" &&
    value.status.length > 0 &&
    isStringOrNull(value.resource_id) &&
    isStringOrNull(value.summary) &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

/**
 * Treat serialized server-function results as untrusted at the rendering boundary.
 * The generic error deliberately excludes response contents, which can contain user data.
 */
export function parseAuditLogRows(value) {
  if (!Array.isArray(value) || !value.every(isAuditRow)) {
    throw new TypeError("Invalid audit log response");
  }
  return value;
}
