import { hashRateLimitIdentity } from "../distributed-rate-limit.mjs";
import { readResponseBytesBounded } from "../endpoint-reliability.mjs";

// These are server policies, not client-selectable rate-limit parameters.
const policies = new Map([
  ["openai_service_request", { limit: 1, seconds: 86400, receipt: true }],
  ["openai_service_minute", { limit: 2, seconds: 60 }],
  ["developer_authentication", { limit: 120, seconds: 60 }],
  ["developer_ingress", { limit: 120, seconds: 60 }],
  ["openai_services_daily", { limit: 20, seconds: 86400 }],
  ["openai_services_compute_daily", { limit: 2, seconds: 86400 }],
  ["openai_search_daily", { limit: 100, seconds: 86400 }],
  ["openai_hosted_chat_global_daily", { limit: 20, seconds: 86400 }],
  ["openai_hosted_chat_user_daily", { limit: 5, seconds: 86400 }],
  ["workspace_semantic_daily", { limit: 60, seconds: 86400 }],
  ["workspace_semantic_global_daily", { limit: 1000, seconds: 86400 }],
  ["workspace_index_daily", { limit: 100, seconds: 86400 }],
  ["openai_webhook_receipt", { limit: 1, seconds: 604800, receipt: true }],
]);
const columns = "identity_hash,action,window_started_at,request_count,expires_at";
const result = (status, retryAfter = 60) =>
  Object.freeze({ status, allowed: status === "allowed", retryAfter });

function backendOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Atomic admission using the existing server-only diagnostic_rate_limits table.
 * The diagnostics RPC intentionally supports only short windows. Keep it intact:
 * daily counters use conditional increments, and receipts use a stable key with
 * rolling expiry so crossing midnight cannot re-admit the same request/event.
 */
export async function consumeOpenAiAdmission({
  identity,
  action,
  limit,
  windowSeconds,
  backendUrl,
  serviceRoleKey,
  hashSecret,
  fetchImpl = fetch,
  timeoutMs = 3000,
  nowMs = Date.now(),
}) {
  const policy = policies.get(action);
  if (
    !policy ||
    limit !== policy.limit ||
    windowSeconds !== policy.seconds ||
    typeof identity !== "string" ||
    !identity ||
    identity.length > 512 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 5000 ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > 8_000_000_000_000_000
  )
    throw new TypeError("Invalid OpenAI admission policy");
  const origin = backendOrigin(backendUrl);
  if (
    !origin ||
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey ||
    typeof hashSecret !== "string" ||
    hashSecret.length < 32 ||
    hashSecret.length > 512
  )
    return result("unavailable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  try {
    const identityHash = await hashRateLimitIdentity(identity, action, hashSecret);
    const windowMs = windowSeconds * 1000;
    const startedAt = policy.receipt ? 0 : Math.floor(nowMs / windowMs) * windowMs;
    const expiry = policy.receipt ? nowMs + windowMs : startedAt + 2 * windowMs;
    const retryAfter = Math.max(1, Math.ceil((startedAt + windowMs - nowMs) / 1000));
    const row = {
      identity_hash: identityHash,
      action,
      window_started_at: new Date(startedAt).toISOString(),
      request_count: 1,
      expires_at: new Date(expiry).toISOString(),
    };
    const key = {
      identity_hash: `eq.${identityHash}`,
      action: `eq.${action}`,
      window_started_at: `eq.${row.window_started_at}`,
    };
    const request = async (method, filters, body) => {
      signal.throwIfAborted();
      const url = new URL(`${origin}/rest/v1/diagnostic_rate_limits`);
      url.search = new URLSearchParams({ select: columns, ...filters }).toString();
      const response = await fetchImpl(url.href, {
        method,
        signal,
        redirect: "error",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer:
            method === "POST"
              ? "resolution=ignore-duplicates,return=representation"
              : "return=representation",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        Promise.resolve(response.body?.cancel()).catch(() => undefined);
        throw new Error("Admission storage unavailable");
      }
      const bytes = await readResponseBytesBounded(response, 2048, { signal, timeoutMs });
      const rows = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid admission result");
      const found = rows[0];
      if (
        found &&
        (found.identity_hash !== identityHash ||
          found.action !== action ||
          Date.parse(found.window_started_at) !== startedAt ||
          !Number.isSafeInteger(found.request_count) ||
          found.request_count < 1 ||
          found.request_count > limit ||
          !Number.isFinite(Date.parse(found.expires_at)))
      )
        throw new Error("Invalid admission record");
      return found;
    };

    for (let attempt = 0; attempt < 8; attempt++) {
      const inserted = await request(
        "POST",
        { on_conflict: "identity_hash,action,window_started_at" },
        row,
      );
      if (inserted) {
        if (inserted.request_count !== 1 || Date.parse(inserted.expires_at) !== expiry)
          return result("unavailable");
        return result("allowed", policy.receipt ? windowSeconds : retryAfter);
      }
      const current = await request("GET", key);
      if (!current) continue; // An expired record may have been cleaned concurrently.
      const expiresAt = Date.parse(current.expires_at);
      if (policy.receipt) {
        if (expiresAt > nowMs)
          return result("limited", Math.min(windowSeconds, Math.ceil((expiresAt - nowMs) / 1000)));
        // Compare the observed expiry so a competing renewal cannot be overwritten.
        const renewed = await request(
          "PATCH",
          { ...key, expires_at: `eq.${current.expires_at}` },
          { expires_at: row.expires_at },
        );
        if (renewed) {
          if (Date.parse(renewed.expires_at) !== expiry) return result("unavailable");
          return result("allowed", windowSeconds);
        }
      } else {
        if (expiresAt !== expiry) return result("unavailable");
        if (current.request_count >= limit) return result("limited", retryAfter);
        // PostgreSQL rechecks this predicate after waiting for a concurrent writer.
        const incremented = await request(
          "PATCH",
          { ...key, request_count: `eq.${current.request_count}` },
          { request_count: current.request_count + 1 },
        );
        if (incremented) {
          if (
            incremented.request_count !== current.request_count + 1 ||
            Date.parse(incremented.expires_at) !== expiry
          )
            return result("unavailable");
          return result("allowed", retryAfter);
        }
      }
    }
    return result("unavailable");
  } catch {
    // Never retry a transport failure: a write may already have committed.
    return result("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
