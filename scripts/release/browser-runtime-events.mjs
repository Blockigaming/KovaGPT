// A CSP-upgraded local request is still an application resource failure, even
// though changing the scheme changes its origin. Do not merge unrelated ports.
export function isApplicationResourceUrl(value, baseUrl) {
  try {
    const actual = new URL(value);
    const expected = new URL(baseUrl);
    if (actual.origin === expected.origin) return true;
    if (expected.protocol !== "http:" || actual.protocol !== "https:") return false;
    expected.protocol = "https:";
    return actual.origin === expected.origin;
  } catch {
    return false;
  }
}

const FATAL_EVENT_TYPES = new Set([
  "page_crash",
  "page_error",
  "navigation_error",
  "diagnostic_error",
  "hydration_timeout",
]);

export function isFatalRuntimeEvent(event, baseUrl) {
  if (FATAL_EVENT_TYPES.has(event.type)) return true;
  return (
    ["request_failed", "http_error"].includes(event.type) &&
    typeof event.url === "string" &&
    isApplicationResourceUrl(event.url, baseUrl)
  );
}
