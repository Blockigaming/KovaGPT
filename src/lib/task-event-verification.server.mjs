import { readResponseBytesBounded } from "./endpoint-reliability.mjs";

const fail = () => {
  throw new Error("task_event_verification_failed");
};
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const match = (value, pattern, max = 250) =>
  typeof value === "string" && value.length <= max && pattern.test(value);
const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const utf8 = new TextEncoder();
function base64url(value, max = 16000) {
  if (!match(value, /^[A-Za-z0-9_-]+$/u, max)) fail();
  try {
    return Uint8Array.from(
      atob(
        value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4),
      ),
      (c) => c.charCodeAt(0),
    );
  } catch {
    fail();
  }
}
async function hmac(secret, signature, prefix, body) {
  if (
    typeof secret !== "string" ||
    secret.length < 16 ||
    secret.length > 1024 ||
    !match(signature, new RegExp(`^${prefix}=[a-f0-9]{64}$`, "u"), 80)
  )
    fail();
  const key = await crypto.subtle.importKey(
    "raw",
    utf8.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(prefix.length + 1).match(/../gu), (part) =>
    parseInt(part, 16),
  );
  if (!(await crypto.subtle.verify("HMAC", key, bytes, utf8.encode(body)))) fail();
}
let cachedKeys = null,
  cachedUntil = 0,
  inFlight = null,
  lastForcedRefresh = Number.NEGATIVE_INFINITY;
async function providerKeys(fetchImpl, now, force = false) {
  if (force && inFlight) return inFlight;
  if (force && cachedKeys && now < lastForcedRefresh + 60_000) return cachedKeys;
  if (!force && cachedKeys && cachedUntil > now) return cachedKeys;
  if (force) lastForcedRefresh = now;
  if (!inFlight)
    inFlight = (async () => {
      const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/certs", {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok) fail();
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readResponseBytesBounded(response, 32000),
        ),
      );
      if (!Array.isArray(value.keys) || !value.keys.length || value.keys.length > 10) fail();
      cachedKeys = value.keys;
      cachedUntil = now + 300000;
      return cachedKeys;
    })().finally(() => {
      inFlight = null;
    });
  return inFlight;
}
export async function verifyGooglePushToken(
  token,
  config,
  { fetchImpl = fetch, now = Date.now() } = {},
) {
  if (!match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u, 16000)) fail();
  if (
    !config.audience ||
    !match(
      config.serviceAccount,
      /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/u,
      320,
    )
  )
    fail();
  const [head, payload, signed] = token.split(".");
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64url(head, 2048)));
    claims = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(base64url(payload, 10000)),
    );
  } catch {
    fail();
  }
  const seconds = now / 1000;
  if (
    header.alg !== "RS256" ||
    !match(header.kid, /^[A-Za-z0-9_-]+$/u, 100) ||
    header.jku ||
    header.jwk ||
    header.crit ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    claims.aud !== config.audience ||
    claims.email !== config.serviceAccount ||
    claims.email_verified !== true ||
    !match(claims.sub, /^\d+$/u, 255) ||
    !Number.isFinite(claims.exp) ||
    !Number.isFinite(claims.iat) ||
    claims.exp <= seconds ||
    claims.iat > seconds + 60 ||
    claims.iat < seconds - 3900 ||
    claims.exp - claims.iat > 3900 ||
    (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 60))
  )
    fail();
  let keys = await providerKeys(fetchImpl, now),
    jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await providerKeys(fetchImpl, now, true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (
    !jwk ||
    jwk.kty !== "RSA" ||
    (jwk.alg && jwk.alg !== "RS256") ||
    (jwk.use && jwk.use !== "sig") ||
    !match(jwk.n, /^[A-Za-z0-9_-]+$/u, 1024) ||
    jwk.e !== "AQAB"
  )
    fail();
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        base64url(signed, 2048),
        utf8.encode(`${head}.${payload}`),
      ))
    )
      fail();
  } catch {
    fail();
  }
  return true;
}
export async function verifyTaskProviderEvent(
  provider,
  request,
  config,
  { fetchImpl = fetch, now = Date.now() } = {},
) {
  if (!["slack", "github", "gmail"].includes(provider)) fail();
  const body = new TextDecoder("utf-8", { fatal: true }).decode(
    await readResponseBytesBounded(request, 256 * 1024, {
      signal: request.signal,
      timeoutMs: 1800,
    }),
  );
  if (provider === "slack") {
    const timestamp = request.headers.get("x-slack-request-timestamp");
    if (!match(timestamp, /^\d{10}$/u, 10) || Math.abs(now / 1000 - Number(timestamp)) > 300)
      fail();
    await hmac(
      config.slackSecret,
      request.headers.get("x-slack-signature"),
      "v0",
      `v0:${timestamp}:${body}`,
    );
  } else if (provider === "github")
    await hmac(config.githubSecret, request.headers.get("x-hub-signature-256"), "sha256", body);
  else {
    const auth = request.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) fail();
    await verifyGooglePushToken(
      auth.slice(7),
      { audience: config.gmailAudience, serviceAccount: config.gmailServiceAccount },
      { fetchImpl, now },
    );
  }
  let payload;
  try {
    payload = object(JSON.parse(body));
  } catch {
    fail();
  }
  const eventKey = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(body))));
  if (provider === "slack") {
    if (payload.type === "url_verification") {
      if (!match(payload.challenge, /^[A-Za-z0-9_-]+$/u, 1000)) fail();
      return { challenge: payload.challenge };
    }
    if (!config.slackAppId || payload.api_app_id !== config.slackAppId) fail();
    if (payload.type !== "event_callback") return { ignored: true };
    const event = object(payload.event);
    if (event.type !== "message" || event.subtype || event.bot_id) return { ignored: true };
    if (
      !match(payload.team_id, /^T[A-Z0-9]{8,30}$/u) ||
      !match(event.channel, /^[CG][A-Z0-9]{8,30}$/u) ||
      !match(event.ts, /^\d{10}\.\d{6}$/u) ||
      !match(event.user, /^[UW][A-Z0-9]{8,30}$/u) ||
      (event.thread_ts != null && !match(event.thread_ts, /^\d{10}\.\d{6}$/u))
    )
      fail();
    return {
      provider,
      eventKey,
      scopeKey: payload.team_id,
      resource: event.channel,
      occurredAt: new Date(Number(event.ts) * 1000).toISOString(),
      reference: { ts: event.ts, threadTs: event.thread_ts ?? null },
    };
  }
  if (provider === "github") {
    const event = request.headers.get("x-github-event"),
      repo = object(payload.repository),
      pull = object(payload.pull_request),
      issue = object(payload.issue);
    let activity;
    if (event === "pull_request" && ["opened", "synchronize", "closed"].includes(payload.action))
      activity = payload.action === "closed" && pull.merged === true ? "merged" : payload.action;
    else if (event === "pull_request_review" && payload.action === "submitted") activity = "review";
    else if (
      (event === "pull_request_review_comment" && payload.action === "created") ||
      (event === "issue_comment" && payload.action === "created" && issue.pull_request)
    )
      activity = "comment";
    else return { ignored: true };
    const number = pull.number ?? issue.number ?? payload.number;
    if (
      !match(repo.full_name, /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u) ||
      repo.full_name.split("/").some((part) => part === "." || part === "..") ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > 999999999
    )
      fail();
    const occurredAt =
      activity === "comment"
        ? object(payload.comment).created_at
        : activity === "review"
          ? object(payload.review).submitted_at
          : pull.updated_at;
    const eventTime = Date.parse(occurredAt);
    if (!Number.isFinite(eventTime) || eventTime > now + 300000) fail();
    if (eventTime < now - 86400000) return { ignored: true };
    return {
      provider,
      eventKey,
      scopeKey: "",
      resource: repo.full_name.toLowerCase(),
      occurredAt: new Date(eventTime).toISOString(),
      reference: { pullNumber: number, activity },
    };
  }
  if (payload.subscription !== config.gmailSubscription || !config.gmailSubscription) fail();
  const message = object(payload.message);
  if (!match(message.data, /^[A-Za-z0-9+/=_-]+$/u, 4000)) fail();
  let value;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(message.data.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
  } catch {
    fail();
  }
  if (
    !match(value.emailAddress, /^[^\s@]+@[^\s@]+$/u, 320) ||
    !match(value.historyId, /^\d{1,30}$/u, 30)
  )
    fail();
  return {
    provider,
    eventKey,
    scopeKey: hex(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", utf8.encode(value.emailAddress.toLowerCase())),
      ),
    ),
    resource: "inbox",
    occurredAt: new Date(now).toISOString(),
    reference: { historyHint: value.historyId },
  };
}
