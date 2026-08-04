const SAFE_RETURN_ORIGIN = "https://oauth-return.invalid";
const OAUTH_COOKIE_MAX_AGE = 600;

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
