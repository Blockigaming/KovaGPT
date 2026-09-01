const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const isStringOrNull = (value) => value === null || typeof value === "string";

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isRfc3339Timestamp(value) {
  if (typeof value !== "string") return false;

  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    Number.isFinite(Date.parse(value))
  );
}

function isAuditRow(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    typeof value.action === "string" &&
    value.action.length > 0 &&
    (value.status === "success" || value.status === "failure") &&
    isStringOrNull(value.resource_id) &&
    isStringOrNull(value.summary) &&
    isRfc3339Timestamp(value.created_at)
  );
}

function isDenseAuditRowArray(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (
      !Object.prototype.hasOwnProperty.call(value, index) ||
      !isAuditRow(value[index])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Treat serialized server-function results as untrusted at the rendering boundary.
 * The generic error deliberately excludes response contents, which can contain user data.
 */
export function parseAuditLogRows(value) {
  if (!Array.isArray(value) || !isDenseAuditRowArray(value)) {
    throw new TypeError("Invalid audit log response");
  }
  return value;
}
