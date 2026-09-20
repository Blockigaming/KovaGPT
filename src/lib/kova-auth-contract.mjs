/**
 * Provider-neutral boundary for the Kova-owned authentication migration.
 *
 * This module intentionally contains no password hashing, token signing, or
 * provider SDK calls. Those operations belong in audited server-only adapters.
 * Keeping mode selection and cookie parsing here makes the cutover contract
 * independently testable and prevents a malformed Kova credential from
 * silently falling back to another identity provider.
 */

export const KOVA_AUTH_MODES = Object.freeze(["supabase", "dual", "kova"]);
export const KOVA_SESSION_COOKIE = "__Host-kova_session";
export const KOVA_AUTH_MODE_ENV = "KOVA_AUTH_MODE";

const OPAQUE_SESSION_TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;

export function resolveKovaAuthMode(env = process.env) {
  const raw = env?.[KOVA_AUTH_MODE_ENV];
  if (raw == null || raw === "") return "supabase";
  if (KOVA_AUTH_MODES.includes(raw)) return raw;
  throw new Error(
    `${KOVA_AUTH_MODE_ENV} must be one of: ${KOVA_AUTH_MODES.join(", ")}`,
  );
}

export function kovaAuthEnabled(mode) {
  return mode === "dual" || mode === "kova";
}

export function supabaseAuthEnabled(mode) {
  return mode === "supabase" || mode === "dual";
}

export function parseCookieHeader(header) {
  const cookies = new Map();
  if (typeof header !== "string" || header.length === 0) return cookies;
  if (header.length > 8192) throw new Error("Cookie header exceeds the authentication limit");

  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!name || cookies.has(name)) continue;
    cookies.set(name, value);
  }
  return cookies;
}

export function readKovaSessionToken(request) {
  const raw = parseCookieHeader(request.headers.get("cookie")).get(KOVA_SESSION_COOKIE);
  if (raw == null) return null;
  if (!OPAQUE_SESSION_TOKEN.test(raw)) {
    return { ok: false, code: "invalid_kova_session_cookie" };
  }
  return { ok: true, token: raw };
}

export function serializeKovaSessionCookie(token, options = {}) {
  if (!OPAQUE_SESSION_TOKEN.test(token)) {
    throw new TypeError("Kova session tokens must be opaque base64url values");
  }
  const maxAge = options.maxAge ?? 60 * 60 * 24 * 30;
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0 || maxAge > 60 * 60 * 24 * 90) {
    throw new RangeError("Kova session max-age must be between 1 second and 90 days");
  }
  return [
    `${KOVA_SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearKovaSessionCookie() {
  return [
    `${KOVA_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Selects exactly one credential for a request.
 *
 * In dual mode, a present Kova cookie is authoritative. Invalid/revoked Kova
 * sessions must fail closed and must never fall back to a Supabase bearer
 * token, which would make logout and revocation bypassable.
 */
export function selectAuthCredential(request, mode = resolveKovaAuthMode()) {
  const kova = readKovaSessionToken(request);
  const authorization = request.headers.get("authorization");
  const hasSupabaseBearer =
    typeof authorization === "string" && /^Bearer[ \t]+[^\s]+$/iu.test(authorization);

  if (kovaAuthEnabled(mode) && kova !== null) {
    if (!kova.ok) return { kind: "invalid", provider: "kova", code: kova.code };
    return { kind: "credential", provider: "kova", token: kova.token };
  }
  if (supabaseAuthEnabled(mode) && hasSupabaseBearer) {
    return { kind: "credential", provider: "supabase", authorization };
  }
  return { kind: "anonymous" };
}
