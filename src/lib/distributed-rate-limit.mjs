const ACTION_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/u;

function unavailable(retryAfter = 60) {
  return Object.freeze({ status: "unavailable", allowed: false, retryAfter });
}

function normalizeBackendUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.href.replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function assertContract(identity, action, limit, windowSeconds, timeoutMs) {
  if (typeof identity !== "string" || !identity || identity.length > 512) {
    throw new TypeError("identity must contain 1 to 512 characters");
  }
  if (typeof action !== "string" || !ACTION_PATTERN.test(action)) {
    throw new TypeError("action must be a stable lowercase identifier");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("limit must be an integer between 1 and 100");
  }
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 10 || windowSeconds > 3600) {
    throw new TypeError("windowSeconds must be an integer between 10 and 3600");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 5000) {
    throw new TypeError("timeoutMs must be an integer between 10 and 5000");
  }
}

export async function hashRateLimitIdentity(identity, action, hashSecret) {
  if (typeof hashSecret !== "string" || hashSecret.length < 32 || hashSecret.length > 512) {
    throw new TypeError("hashSecret must contain 32 to 512 characters");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(hashSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${action}\u0000${identity}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Consume an atomic, cross-instance rate-limit bucket in Supabase.
 * Configuration or transport failures deny the protected operation so a
 * database outage cannot turn an expensive public route into an unlimited one.
 */
export async function consumeDistributedRateLimit({
  identity,
  action,
  limit,
  windowSeconds,
  backendUrl,
  serviceRoleKey,
  hashSecret,
  fetchImpl = fetch,
  timeoutMs = 1200,
}) {
  assertContract(identity, action, limit, windowSeconds, timeoutMs);
  const url = normalizeBackendUrl(backendUrl);
  if (
    !url ||
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey ||
    typeof hashSecret !== "string" ||
    hashSecret.length < 32 ||
    hashSecret.length > 512
  ) {
    return unavailable();
  }

  try {
    const identityHash = await hashRateLimitIdentity(identity, action, hashSecret);
    const response = await fetchImpl(`${url}/rest/v1/rpc/consume_diagnostic_rate_limit`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_identity_hash: identityHash,
        p_action: action,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });
    if (!response.ok) return unavailable();

    const payload = await response.json();
    const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
    if (
      !row ||
      typeof row.allowed !== "boolean" ||
      !Number.isSafeInteger(row.retry_after) ||
      row.retry_after < 1 ||
      row.retry_after > windowSeconds
    ) {
      return unavailable();
    }

    return Object.freeze({
      status: row.allowed ? "allowed" : "limited",
      allowed: row.allowed,
      retryAfter: row.retry_after,
    });
  } catch {
    return unavailable();
  }
}
