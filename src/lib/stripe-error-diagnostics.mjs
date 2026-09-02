const MAX_DIAGNOSTIC_VALUE_LENGTH = 96;

function readProperty(value, key) {
  if (
    !value ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function diagnosticValue(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH);
}

function firstDiagnosticValue(...values) {
  for (const value of values) {
    const normalized = diagnosticValue(value);
    if (normalized) return normalized;
  }
  return undefined;
}

export function stripeErrorDiagnostic(error, stage) {
  const raw = readProperty(error, "raw");
  const rawHeaders = readProperty(raw, "headers");
  const diagnostic = {
    stage: firstDiagnosticValue(stage) ?? "unknown",
    errorType:
      firstDiagnosticValue(
        readProperty(error, "type"),
        readProperty(raw, "type"),
        readProperty(error, "name"),
      ) ?? "unknown_error",
  };

  const errorCode = firstDiagnosticValue(
    readProperty(error, "code"),
    readProperty(raw, "code"),
  );
  if (errorCode) diagnostic.errorCode = errorCode;

  const requestId = firstDiagnosticValue(
    readProperty(error, "requestId"),
    readProperty(raw, "requestId"),
    readProperty(rawHeaders, "request-id"),
  );
  if (requestId) diagnostic.requestId = requestId;

  return diagnostic;
}
