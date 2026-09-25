import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;
const SESSION_DIGEST = /^[a-f0-9]{64}$/u;

export function generateKovaSessionToken() {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function digestKovaSessionToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/u.test(token)) {
    throw new TypeError("Invalid Kova session token");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionDigestMatches(token, expectedDigest) {
  if (typeof expectedDigest !== "string" || !SESSION_DIGEST.test(expectedDigest)) return false;
  let actual;
  try {
    actual = digestKovaSessionToken(token);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedDigest, "hex"));
}

function validInstant(value) {
  if (typeof value !== "string") return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

/**
 * Validates a database session row after lookup by token digest.
 * The raw token must never be persisted, logged, or returned from this function.
 */
export function evaluateKovaSession(session, account, now = Date.now()) {
  if (!session || !account || typeof account.id !== "string" || !account.id) {
    return { ok: false, status: 401, code: "invalid_session" };
  }
  if (session.account_id !== account.id || typeof session.id !== "string" || !session.id) {
    return { ok: false, status: 401, code: "invalid_session" };
  }
  if (session.revoked_at != null || account.deleted_at != null) {
    return { ok: false, status: 401, code: "invalid_session" };
  }

  const expiresAt = validInstant(session.expires_at);
  if (expiresAt == null || expiresAt <= now) {
    return { ok: false, status: 401, code: "invalid_session" };
  }

  if (account.suspended_until != null) {
    const suspendedUntil = validInstant(account.suspended_until);
    if (suspendedUntil == null || suspendedUntil > now) {
      return { ok: false, status: 403, code: "account_suspended" };
    }
  }

  const assuranceLevel = session.assurance_level;
  if (assuranceLevel !== "aal1" && assuranceLevel !== "aal2") {
    return { ok: false, status: 401, code: "invalid_session" };
  }
  if (account.mfa_required === true && assuranceLevel !== "aal2") {
    return { ok: false, status: 403, code: "mfa_required" };
  }

  return {
    ok: true,
    accountId: account.id,
    sessionId: session.id,
    emailVerified: account.email_verified_at != null,
    assuranceLevel,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}
