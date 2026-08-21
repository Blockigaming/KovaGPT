const SAFE_RETURN_ORIGIN = "https://oauth-return.invalid";
const OAUTH_COOKIE_MAX_AGE = 600;
const SAFE_OAUTH_CODES = new Set([
  "provider_not_configured",
  "oauth_state_store_failed",
  "invalid_or_expired_oauth_state",
  "invalid_oauth_browser_binding",
  "oauth_state_replayed",
  "oauth_access_token_missing",
  "oauth_profile_identity_missing",
  "linked_account_store_failed",
  "linked_account_not_found",
  "unsupported_linked_account_provider",
  "linked_account_deletion_request_failed",
  "linked_account_sync_cancellation_failed",
  "linked_account_purge_failed",
  "linked_account_disconnect_failed",
]);

export const INTEGRATION_OAUTH_COOKIE = "__Host-kova_integration_oauth";
export const GITHUB_OAUTH_COOKIE = "__Host-kova_github_oauth";

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizeOAuthReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) {
    return "/apps";
  }

  try {
    const parsed = new URL(value, SAFE_RETURN_ORIGIN);
    if (parsed.origin !== SAFE_RETURN_ORIGIN) return "/apps";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/apps";
  }
}

export function publicOAuthErrorCode(
  error: unknown,
  fallback: "oauth_start_failed" | "disconnect_failed" | "connection_failed",
): string {
  const raw = error instanceof Error ? error.message : "";
  if (SAFE_OAUTH_CODES.has(raw)) return raw;
  if (/^oauth_(?:exchange|profile)_\d{3}$/u.test(raw)) return "connection_failed";
  return fallback;
}

export function safeOAuthLogCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (SAFE_OAUTH_CODES.has(raw)) return raw;
  if (/^oauth_(?:exchange|profile)_\d{3}$/u.test(raw)) return raw;
  return "oauth_failure";
}

export function serializeOauthCookie(name: string, value: string): string {
  return (
    name +
    "=" +
    encodeURIComponent(value) +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" +
    OAUTH_COOKIE_MAX_AGE
  );
}

export function clearOauthCookie(name: string): string {
  return name + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function readOauthCookie(request: Request, name: string): string | null {
  const prefix = name + "=";
  const pair = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice(prefix.length));
  } catch {
    return null;
  }
}

export function redirectClearingOauthCookie(location: URL | string, cookieName: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      "Set-Cookie": clearOauthCookie(cookieName),
    },
  });
}
