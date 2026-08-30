const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOSTED_RUNTIME_MARKERS = [
  "CONTAINER_APP_NAME",
  "CONTAINER_APP_REVISION",
  "WEBSITE_INSTANCE_ID",
] as const;

// This opt-in is for an HTTP server bound to loopback, never a deployed origin.
// NODE_ENV is deliberately not used: a production build is also previewed locally.
export function applyLocalPreviewTransportPolicy(
  headers: Headers,
  request: Request,
  environment: Record<string, string | undefined> = process.env,
): void {
  if (environment.KOVA_LOCAL_HTTP_PREVIEW !== "1") return;
  if (environment.KOVA_RUNTIME_PLATFORM === "azure-container-apps") return;
  if (HOSTED_RUNTIME_MARKERS.some((name) => Boolean(environment[name]?.trim()))) return;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return;

  const policy = headers.get("Content-Security-Policy");
  if (policy) {
    headers.set(
      "Content-Security-Policy",
      policy
        .split(";")
        .map((directive) => directive.trim())
        .filter((directive) => directive.toLowerCase() !== "upgrade-insecure-requests")
        .filter(Boolean)
        .join("; "),
    );
  }
  headers.delete("Strict-Transport-Security");
}
