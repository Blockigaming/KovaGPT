export function parseBearerToken(header) {
  if (typeof header !== "string") return null;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function verifiedFactorCount(user) {
  if (!Array.isArray(user?.factors)) return 0;
  return user.factors.filter((factor) => factor?.status === "verified").length;
}

export function evaluateAuthenticatedUser(user, claims, now = Date.now()) {
  if (!user || typeof user.id !== "string" || !user.id || user.deleted_at) {
    return { ok: false, status: 401, code: "invalid_session" };
  }

  if (user.banned_until) {
    const bannedUntil =
      typeof user.banned_until === "string" ? Date.parse(user.banned_until) : Number.NaN;
    if (!Number.isFinite(bannedUntil) || bannedUntil > now) {
      return { ok: false, status: 403, code: "account_suspended" };
    }
  }

  const hasVerifiedFactor = verifiedFactorCount(user) > 0;
  const assuranceLevel = typeof claims?.aal === "string" ? claims.aal : "aal1";
  if (hasVerifiedFactor && assuranceLevel !== "aal2") {
    return { ok: false, status: 403, code: "mfa_required" };
  }

  return {
    ok: true,
    userId: user.id,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    assuranceLevel,
  };
}

export function isCrossSiteMutation(request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

export function safeRelativeRedirect(candidate, baseOrigin, blockedPrefix = "/~oauth/callback") {
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return "/";
  try {
    const parsed = new URL(candidate, baseOrigin);
    if (parsed.origin !== new URL(baseOrigin).origin) return "/";
    if (parsed.pathname.startsWith(blockedPrefix)) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
