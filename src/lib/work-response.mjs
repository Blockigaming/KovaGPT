const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringOrNull = (value) => value === null || typeof value === "string";

function isWorkRun(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.kind === "browser" || value.kind === "team") &&
    typeof value.status === "string" &&
    value.status.length > 0 &&
    Number.isInteger(value.attempts) &&
    value.attempts >= 0 &&
    Number.isInteger(value.maxAttempts) &&
    value.maxAttempts >= 0 &&
    isStringOrNull(value.projectId) &&
    typeof value.createdAt === "string" &&
    value.createdAt.length > 0 &&
    isStringOrNull(value.startedAt) &&
    isStringOrNull(value.completedAt) &&
    isStringOrNull(value.error) &&
    isRecord(value.input)
  );
}

/**
 * Treat serialized server-function results as untrusted at the rendering boundary.
 * The generic error deliberately excludes response contents, which can contain user data.
 */
export function parseWorkRunList(value) {
  if (!Array.isArray(value) || !value.every(isWorkRun)) {
    throw new TypeError("Invalid Work runs response");
  }
  return value;
}
