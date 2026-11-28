// Public error mapping deliberately excludes provider payloads and arbitrary exception text.
export function developerHttpError(error) {
  const bodyCode = error instanceof Error && "code" in error ? error.code : null;
  if (bodyCode === "request_too_large")
    return { status: 413, code: "developer_input_too_large", message: "request too large" };
  if (
    ["invalid_content_length", "invalid_utf8", "invalid_json", "invalid_request_body"].includes(
      String(bodyCode),
    )
  )
    return { status: 400, code: "developer_input_invalid", message: "invalid request body" };
  const code =
    error instanceof Error && /^developer_[a-z_]+$/.test(error.message)
      ? error.message
      : "developer_unavailable";
  const status = /unauthorized/.test(code)
    ? 401
    : /scope|owner_required/.test(code)
      ? 403
      : /not_found/.test(code)
        ? 404
        : /conflict|quote_expired|quote_changed|quota_exceeded/.test(code)
          ? 409
          : /invalid|required|too_large/.test(code)
            ? 400
            : /rate_limit/.test(code)
              ? 429
              : 503;
  return { status, code, message: code.replaceAll("_", " ") };
}
// Rate limiter failures are unavailable, not ordinary exhaustion. Never allow
// work to proceed if the distributed limiter cannot establish authorization.
export function developerRateError(result) {
  if (result?.allowed === true && result.status === "allowed") return null;
  return new Error(
    result?.status === "limited" ? "developer_rate_limit" : "developer_rate_unavailable",
  );
}
export function developerRetryHeaders(status) {
  // All current developer REST throttles use 60-second windows. A conservative
  // full-window delay avoids advertising a shorter, unverified reset time.
  return status === 429 ? { "Retry-After": "60" } : {};
}
