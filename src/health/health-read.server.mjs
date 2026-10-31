import { readResponseBytesBounded } from "../lib/endpoint-reliability.mjs";

const definitions = Object.freeze({
  oura: {
    base: "https://api.ouraring.com/v2/usercollection/",
    paths: { sleep: "daily_sleep", recovery: "daily_readiness", activity: "daily_activity" },
    scopes: { sleep: "daily", recovery: "daily", activity: "daily" },
  },
  whoop: {
    base: "https://api.prod.whoop.com/developer/v2/",
    paths: { sleep: "activity/sleep", recovery: "recovery", activity: "cycle" },
    scopes: { sleep: "read:sleep", recovery: "read:recovery", activity: "read:cycles" },
  },
});
export function healthReadRequest(provider, metric, token, now = Date.now()) {
  if (!Object.hasOwn(definitions, provider) || !Object.hasOwn(definitions[provider].paths, metric))
    throw new Error("unsupported_health_read");
  if (typeof token !== "string" || !token || token.length > 8192 || /[\r\n]/u.test(token))
    throw new Error("invalid_health_token");
  const definition = definitions[provider];
  const url = new URL(definition.paths[metric], definition.base);
  const start = new Date(now - 7 * 86_400_000).toISOString();
  const end = new Date(now).toISOString();
  if (provider === "oura") {
    url.searchParams.set("start_date", start.slice(0, 10));
    url.searchParams.set("end_date", end.slice(0, 10));
  } else {
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("limit", "25");
  }
  return {
    url: url.href,
    scope: definition.scopes[metric],
    init: {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "KovaGPT/1.0",
      },
    },
  };
}

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
export async function confirmedHealthScopes(
  provider,
  requested,
  reported,
  token,
  fetchImpl = fetch,
  ensureCurrent = async () => {},
) {
  if (typeof reported === "string") return reported.split(/[ ,]+/).filter(Boolean);
  // Oura permits users to uncheck requested scopes and may omit `scope` from
  // the token response. Never promote the requested list to a granted list.
  const granted = provider === "oura" ? ["personal"] : ["read:profile"];
  const checked = new Set();
  for (const metric of ["sleep", "recovery", "activity"]) {
    const request = healthReadRequest(provider, metric, token);
    if (!requested.includes(request.scope) || checked.has(request.scope)) continue;
    checked.add(request.scope);
    await ensureCurrent();
    const response = await fetchImpl(request.url, request.init);
    if (response.status === 403) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("oauth_scope_check_failed");
    }
    let body;
    try {
      body = JSON.parse(
        new TextDecoder("utf8", { fatal: true }).decode(
          await readResponseBytesBounded(response, 256 * 1024, {
            signal: request.init.signal,
            timeoutMs: 12_000,
          }),
        ),
      );
    } catch {
      throw new Error("oauth_scope_check_failed");
    }
    if (!Array.isArray(provider === "oura" ? body?.data : body?.records))
      throw new Error("oauth_scope_check_failed");
    await ensureCurrent();
    granted.push(request.scope);
  }
  return granted;
}
export async function readHealthSummary(
  provider,
  scopes,
  token,
  ensureCurrent,
  fetchImpl = fetch,
  now = Date.now(),
) {
  if (!Object.hasOwn(definitions, provider)) throw new Error("unsupported_health_read");
  const summaries = [];
  let limited = false;
  const missing = [];
  for (const metric of ["sleep", "recovery", "activity"]) {
    const request = healthReadRequest(provider, metric, token, now);
    if (!scopes.includes(request.scope)) {
      missing.push(metric);
      continue;
    }
    await ensureCurrent();
    const response = await fetchImpl(request.url, request.init);
    if (!response.ok) {
      Promise.resolve(response.body?.cancel()).catch(() => undefined);
      throw new Error(
        response.status === 401
          ? "health_reconnect_required"
          : response.status === 403
            ? "health_access_denied"
            : "health_provider_unavailable",
      );
    }
    let body;
    try {
      const bytes = await readResponseBytesBounded(response, 256 * 1024, {
        signal: request.init.signal,
        timeoutMs: 12_000,
      });
      body = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("health_response_rejected");
    }
    const rows = provider === "oura" ? body?.data : body?.records;
    if (
      !Array.isArray(rows) ||
      rows.length > 100 ||
      rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    )
      throw new Error("health_response_rejected");
    limited ||= Boolean(body.next_token) || rows.length > 25;
    for (const row of rows.slice(0, 25)) {
      const score =
        provider === "oura"
          ? row.score
          : metric === "sleep"
            ? row.score?.sleep_performance_percentage
            : metric === "recovery"
              ? row.score?.recovery_score
              : row.score?.strain;
      // No arbitrary provider fields, personal profile, raw biometrics, provider
      // tokens, or free-form notes are forwarded or indexed.
      summaries.push({
        metric,
        date:
          typeof (row.day ?? row.start ?? row.created_at) === "string"
            ? (row.day ?? row.start ?? row.created_at).slice(0, 10)
            : null,
        score: finite(score),
        scoreUnit: provider === "whoop" && metric === "activity" ? "strain" : "score",
        steps: metric === "activity" ? finite(row.steps) : null,
        restingHeartRate:
          provider === "whoop" && metric === "recovery"
            ? finite(row.score?.resting_heart_rate)
            : null,
      });
    }
    await ensureCurrent();
  }
  if (missing.length === 3) throw new Error("health_permission_required");
  await ensureCurrent();
  return { provider, fetchedAt: new Date(now).toISOString(), summaries, missing, limited };
}
