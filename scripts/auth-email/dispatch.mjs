import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import {
  renderKovaAuthEmail,
  renderLegacyKovaAuthEmail,
} from "../../src/lib/kova-auth-email.server.mjs";

// Existing Resend resource only; no provider signup, SDK, daemon or cron setup.
// https://resend.com/docs/api-reference/emails/send-email
// https://resend.com/docs/dashboard/emails/idempotency-keys
// https://resend.com/docs/api-reference/errors
const ID = /^[A-Za-z0-9_-]{43}$/u;
const PROVIDER_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const fail = (code) => {
  throw new Error(`kova_auth_email_${code}`);
};
const origin = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.origin === value) return value;
  } catch {}
  fail("origin_invalid");
};
const list = (value, pattern) => {
  const values = typeof value === "string" ? value.split(",") : [];
  if (
    values.length < 1 ||
    values.length > 5 ||
    new Set(values).size !== values.length ||
    values.some((v) => !pattern.test(v))
  )
    fail("scope_invalid");
  return values;
};

export function emailDispatchConfiguration(env, now = Date.now()) {
  if (
    env.AZURE_ENVIRONMENT !== "staging" ||
    env.CONTAINER_APP_NAME !== "ca-kovagpt-staging" ||
    env.KOVA_AUTH_MODE !== "kova" ||
    env.KOVA_EMAIL_QUEUE_ENABLED !== "true" ||
    env.KOVA_AUTH_EMAIL_DISPATCH_ENABLED !== "true"
  )
    fail("execution_disabled");
  const publicOrigin = origin(env.KOVA_AUTH_PUBLIC_ORIGIN);
  if (!/^https:\/\/ca-kovagpt-staging\.[a-z0-9.-]+\.azurecontainerapps\.io$/u.test(publicOrigin))
    fail("staging_origin_required");
  if (origin(env.KOVA_AUTH_EMAIL_EXPECTED_ORIGIN) !== publicOrigin) fail("origin_binding");
  const databaseOrigin = origin(env.SUPABASE_URL);
  const projectRef = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u.exec(databaseOrigin)?.[1];
  const productionRefs = [
    ...readFileSync(new URL("../../src/config/public-config.ts", import.meta.url), "utf8").matchAll(
      /https:\/\/([a-z0-9]{20})\.supabase\.co/gu,
    ),
  ].map((match) => match[1]);
  if (
    !projectRef ||
    projectRef !== env.KOVA_EXPECTED_SUPABASE_PROJECT_REF ||
    productionRefs.includes(projectRef)
  )
    fail("staging_database_required");
  if (origin(env.KOVA_AUTH_EMAIL_DATABASE_ORIGIN) !== databaseOrigin) fail("database_binding");
  const messageIds = list(env.KOVA_AUTH_EMAIL_MESSAGE_IDS, ID);
  const recipients = list(env.KOVA_AUTH_EMAIL_RECIPIENTS, /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u);
  if (recipients.some((v) => v !== v.toLowerCase() || v.length > 320)) fail("scope_invalid");
  const issuedNotBefore = env.KOVA_AUTH_EMAIL_ISSUED_NOT_BEFORE;
  const issued = Date.parse(issuedNotBefore);
  if (
    !Number.isFinite(issued) ||
    new Date(issued).toISOString() !== issuedNotBefore ||
    issued > now ||
    issued < now - 15 * 60_000
  )
    fail("scope_expired");
  const maxSends = Number(env.KOVA_AUTH_EMAIL_MAX_SENDS);
  if (!Number.isInteger(maxSends) || maxSends < 1 || maxSends > 5 || maxSends > messageIds.length)
    fail("budget_invalid");
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"]) {
    if (typeof env[key] !== "string" || env[key].length < 16 || /[\r\n]/u.test(env[key]))
      fail("private_configuration_missing");
  }
  return {
    publicOrigin,
    databaseOrigin,
    messageIds,
    recipients,
    issuedNotBefore,
    maxSends,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    resendKey: env.RESEND_API_KEY,
  };
}

async function boundedJson(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function createEmailRpc(config, fetcher = fetch) {
  return async (name, body) => {
    if (
      ![
        "kova_auth_claim_email_dispatch",
        "kova_auth_prepare_email_dispatch",
        "kova_auth_finish_email_dispatch",
      ].includes(name)
    )
      fail("rpc_invalid");
    let response;
    try {
      response = await fetcher(`${config.databaseOrigin}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      fail("database_unavailable");
    }
    const data = await boundedJson(response, 32768);
    if (!response.ok || data === null) fail("database_unavailable");
    return data;
  };
}

export function validatedAuthEmail(payload, config) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !config.messageIds.includes(payload.message_id) ||
    !config.recipients.includes(payload.to) ||
    payload.purpose !== "auth" ||
    payload.from !== "KovaGPT <noreply@kovagpt.com>" ||
    payload.sender_domain !== "notify.kovagpt.com"
  )
    fail("envelope_invalid");
  const recovery = payload.label === "kova-auth-recovery";
  if (!recovery && payload.label !== "kova-auth-verification") fail("envelope_invalid");
  const action = recovery ? "Reset password" : "Verify email";
  if (
    payload.subject !== (recovery ? "Reset your KovaGPT password" : "Verify your KovaGPT email") ||
    typeof payload.html !== "string" ||
    typeof payload.text !== "string" ||
    !payload.html ||
    !payload.text ||
    Buffer.byteLength(JSON.stringify(payload)) > 16384
  )
    fail("envelope_invalid");
  const links = payload.text.split("\n\n").filter((line) => line.startsWith(`${action}: `));
  if (links.length !== 1) fail("envelope_invalid");
  let link;
  try {
    link = new URL(links[0].slice(action.length + 2));
  } catch {
    fail("envelope_invalid");
  }
  if (
    link.origin !== config.publicOrigin ||
    link.username ||
    link.password ||
    link.pathname !== (recovery ? "/reset-password" : "/api/auth/verify") ||
    (recovery ? link.search : link.hash)
  )
    fail("envelope_invalid");
  const params = recovery ? new URLSearchParams(link.hash.slice(1)) : link.searchParams;
  const token = params.get("token");
  if (
    [...params.keys()].join() !== "token" ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(token ?? "") ||
    payload.idempotency_key !==
      `${payload.label}:${createHash("sha256").update(token).digest("hex")}` ||
    payload.idempotency_key.length > 256
  )
    fail("envelope_invalid");
  // Do not trust arbitrary queue HTML/URLs. Verify it is the same HTML produced
  // by the owned renderer before provider dispatch (and the exact plain text).
  const issued = Date.parse(payload.queued_at);
  if (
    !Number.isFinite(issued) ||
    new Date(issued).toISOString() !== payload.queued_at ||
    issued < Date.parse(config.issuedNotBefore)
  )
    fail("envelope_invalid");
  const renderInput = {
    label: payload.label,
    recipient: payload.to,
    link: link.toString(),
    publicOrigin: config.publicOrigin,
    issuedAt: payload.queued_at,
    expiresAt: new Date(issued + 3600_000).toISOString(),
  };
  const rendered = renderKovaAuthEmail(renderInput);
  // Accept only either exact canonical version. Deliver queued bytes unchanged:
  // a prior provider acceptance may be awaiting its database acknowledgement.
  if (
    (rendered.html !== payload.html &&
      renderLegacyKovaAuthEmail(renderInput).html !== payload.html) ||
    rendered.text !== payload.text ||
    rendered.subject !== payload.subject
  )
    fail("envelope_invalid");
  return {
    from: payload.from,
    to: [payload.to],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  };
}

export function createResendSender(config, fetcher = fetch) {
  return async (payload, body) => {
    let response;
    try {
      response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${config.resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": payload.idempotency_key,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { outcome: "retry", errorCode: "provider_transport" };
    }
    const data = await boundedJson(response, 8192);
    if (response.ok && typeof data?.id === "string" && PROVIDER_ID.test(data.id))
      return { outcome: "sent", providerId: data.id };
    const retryAfter = response.headers.get("retry-after");
    const seconds = /^\d+$/u.test(retryAfter ?? "")
      ? Number(retryAfter)
      : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
    if (response.status === 429)
      return {
        outcome: "retry",
        errorCode: "provider_limited",
        retryAfterSeconds: Number.isFinite(seconds) ? Math.max(1, Math.min(3600, seconds)) : 60,
      };
    if (response.status >= 500 || response.status === 408 || response.ok)
      return { outcome: "retry", errorCode: "provider_unavailable" };
    if (response.status === 409 && data?.name === "concurrent_idempotent_requests")
      return { outcome: "retry", errorCode: "provider_concurrent" };
    return {
      outcome: "failed",
      errorCode: response.status === 409 ? "provider_idempotency_conflict" : "provider_rejected",
    };
  };
}

export async function dispatchAuthEmailBatch(
  config,
  { rpc = createEmailRpc(config), send = createResendSender(config), now = Date.now } = {},
) {
  const summary = { attempted: 0, sent: 0, retry: 0, failed: 0, skipped: 0 };
  const batchDeadline = now() + 180_000;
  for (let i = 0; i < config.maxSends && now() + 40_000 < batchDeadline; i += 1) {
    const lease = randomUUID();
    const rows = await rpc("kova_auth_claim_email_dispatch", {
      p_lease_token: lease,
      p_message_ids: config.messageIds,
      p_recipients: config.recipients,
      p_not_before: config.issuedNotBefore,
    });
    if (!Array.isArray(rows) || rows.length > 1) fail("claim_invalid");
    if (!rows.length) break;
    const row = rows[0];
    if (
      !/^\d+$/u.test(String(row.queue_id)) ||
      !Number.isInteger(row.attempt) ||
      row.attempt < 1 ||
      row.attempt > 5 ||
      !Number.isFinite(Date.parse(row.lease_expires_at)) ||
      Date.parse(row.lease_expires_at) <= now() + 25_000
    )
      fail("claim_invalid");
    let body, result;
    try {
      body = validatedAuthEmail(row.payload, config);
    } catch {
      result = { outcome: "failed", errorCode: "envelope_invalid" };
    }
    if (!result) {
      if (
        (await rpc("kova_auth_prepare_email_dispatch", {
          p_queue_id: row.queue_id,
          p_lease_token: lease,
        })) !== true
      ) {
        summary.skipped += 1;
        continue;
      }
      if (Date.parse(row.lease_expires_at) <= now() + 15_000) {
        summary.skipped += 1;
        continue;
      }
      summary.attempted += 1;
      result = await send(row.payload, body);
    }
    const recorded = await rpc("kova_auth_finish_email_dispatch", {
      p_queue_id: row.queue_id,
      p_lease_token: lease,
      p_outcome: result.outcome,
      p_error_code: result.errorCode ?? null,
      p_provider_id: result.providerId ?? null,
      p_retry_after_seconds: result.retryAfterSeconds ?? null,
    });
    if (recorded !== true) fail("completion_uncertain");
    summary[result.outcome] += 1;
  }
  return summary;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || argv[0] !== "--execute")
    return { execution_enabled: false, reason: "explicit_execute_required" };
  return dispatchAuthEmailBatch(emailDispatchConfiguration(env));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ error: /^kova_auth_email_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "kova_auth_email_dispatch_failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
