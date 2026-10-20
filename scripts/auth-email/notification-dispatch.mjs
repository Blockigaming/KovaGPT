import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ACCOUNT_EMAIL_EVENTS } from "../../src/lib/account-email-preferences.mjs";
import { renderKovaAccountEmail } from "../../src/lib/kova-account-email.server.mjs";
import { createResendSender } from "./dispatch.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const EVENTS = new Set(ACCOUNT_EMAIL_EVENTS.map(({ key }) => key));
const RPCS = new Set([
  "account_email_claim_dispatch",
  "account_email_prepare_dispatch",
  "account_email_finish_dispatch",
]);
const fail = (code) => {
  throw new Error(`kova_account_email_${code}`);
};
const origin = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.origin === value) return value;
  } catch {}
  fail("origin_invalid");
};

/** Explicit, staging-only operator scope. This is not spending authorization. */
export function accountNotificationConfiguration(env, now = Date.now()) {
  if (
    env.AZURE_ENVIRONMENT !== "staging" ||
    env.CONTAINER_APP_NAME !== "ca-kovagpt-staging" ||
    env.KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED !== "true"
  )
    fail("execution_disabled");
  const publicOrigin = origin(env.KOVA_AUTH_PUBLIC_ORIGIN);
  if (!/^https:\/\/ca-kovagpt-staging\.[a-z0-9.-]+\.azurecontainerapps\.io$/u.test(publicOrigin))
    fail("staging_origin_required");
  if (origin(env.KOVA_ACCOUNT_EMAIL_EXPECTED_ORIGIN) !== publicOrigin) fail("origin_binding");
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
  if (origin(env.KOVA_ACCOUNT_EMAIL_DATABASE_ORIGIN) !== databaseOrigin) fail("database_binding");
  const eventIds =
    typeof env.KOVA_ACCOUNT_EMAIL_EVENT_IDS === "string"
      ? env.KOVA_ACCOUNT_EMAIL_EVENT_IDS.split(",")
      : [];
  if (
    !eventIds.length ||
    eventIds.length > 5 ||
    new Set(eventIds).size !== eventIds.length ||
    eventIds.some((id) => !UUID.test(id))
  )
    fail("scope_invalid");
  const issuedNotBefore = env.KOVA_ACCOUNT_EMAIL_ISSUED_NOT_BEFORE;
  const issued = Date.parse(issuedNotBefore);
  if (
    !Number.isFinite(issued) ||
    new Date(issued).toISOString() !== issuedNotBefore ||
    issued > now ||
    issued < now - 15 * 60_000
  )
    fail("scope_expired");
  const maxSends = Number(env.KOVA_ACCOUNT_EMAIL_MAX_SENDS);
  if (!Number.isInteger(maxSends) || maxSends < 1 || maxSends > 5 || maxSends > eventIds.length)
    fail("budget_invalid");
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"])
    if (typeof env[key] !== "string" || env[key].length < 16 || /[\r\n]/u.test(env[key]))
      fail("private_configuration_missing");
  return {
    publicOrigin,
    databaseOrigin,
    eventIds,
    issuedNotBefore,
    maxSends,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    resendKey: env.RESEND_API_KEY,
  };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail("database_unavailable");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) {
        await reader.cancel().catch(() => {});
        fail("database_unavailable");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("database_unavailable");
  } finally {
    reader.releaseLock();
  }
}

export function createAccountNotificationRpc(config, fetcher = fetch) {
  return async (name, body) => {
    if (!RPCS.has(name)) fail("rpc_invalid");
    let response;
    try {
      response = await fetcher(`${config.databaseOrigin}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
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
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      fail("database_unavailable");
    }
    return boundedJson(response);
  };
}

export function accountNotificationBody(row, config, now = Date.now()) {
  if (
    !row ||
    !UUID.test(row.id ?? "") ||
    !config.eventIds.includes(row.id) ||
    !EVENTS.has(row.event_type) ||
    typeof row.recipient !== "string" ||
    row.recipient !== row.recipient.toLowerCase() ||
    row.recipient.length > 320 ||
    !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u.test(row.recipient)
  )
    fail("envelope_invalid");
  const occurred = Date.parse(row.occurred_at);
  if (
    typeof row.occurred_at !== "string" ||
    row.occurred_at.length > 40 ||
    !Number.isFinite(occurred) ||
    occurred < Date.parse(config.issuedNotBefore) ||
    occurred > now + 60_000
  )
    fail("envelope_invalid");
  if (
    !row.metadata ||
    typeof row.metadata !== "object" ||
    Array.isArray(row.metadata) ||
    Object.keys(row.metadata).some((key) => key !== "deletion_scheduled_for")
  )
    fail("envelope_invalid");
  const rendered = renderKovaAccountEmail({
    event: row.event_type,
    publicOrigin: config.publicOrigin,
    occurredAt: row.occurred_at,
    deletionScheduledFor: row.metadata.deletion_scheduled_for,
  });
  return { from: "KovaGPT <noreply@kovagpt.com>", to: [row.recipient], ...rendered };
}

export async function dispatchAccountNotifications(
  config,
  {
    rpc = createAccountNotificationRpc(config),
    send = createResendSender(config),
    now = Date.now,
  } = {},
) {
  const summary = { attempted: 0, sent: 0, uncertain: 0, failed: 0, skipped: 0 };
  const deadline = now() + 180_000;
  const rows = await rpc("account_email_claim_dispatch", {
    p_event_ids: config.eventIds.slice(0, config.maxSends),
    p_not_before: config.issuedNotBefore,
  });
  if (
    !Array.isArray(rows) ||
    rows.length > config.maxSends ||
    new Set(rows.map((row) => row?.id)).size !== rows.length
  )
    fail("claim_invalid");
  for (const row of rows) {
    if (
      !UUID.test(row?.lease_token ?? "") ||
      Date.parse(row.lease_expires_at) <= now() + 25_000 ||
      !Number.isFinite(Date.parse(row.lease_expires_at))
    )
      fail("claim_invalid");
    if (now() + 40_000 >= deadline) {
      summary.skipped += 1;
      break;
    }
    let body;
    try {
      body = accountNotificationBody(row, config, now());
    } catch {
      const recorded = await rpc("account_email_finish_dispatch", {
        p_event_id: row.id,
        p_lease_token: row.lease_token,
        p_outcome: "failed",
      });
      if (recorded !== true) fail("completion_uncertain");
      summary.failed += 1;
      continue;
    }
    if (
      (await rpc("account_email_prepare_dispatch", {
        p_event_id: row.id,
        p_lease_token: row.lease_token,
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
    let result;
    try {
      result = await send({ idempotency_key: `kova-account-email:${row.id}` }, body);
    } catch {
      result = { outcome: "retry" };
    }
    const outcome =
      result?.outcome === "sent" ? "sent" : result?.outcome === "failed" ? "failed" : "uncertain";
    if (
      (await rpc("account_email_finish_dispatch", {
        p_event_id: row.id,
        p_lease_token: row.lease_token,
        p_outcome: outcome,
      })) !== true
    )
      fail("completion_uncertain");
    summary[outcome] += 1;
  }
  return summary;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || argv[0] !== "--execute")
    return { execution_enabled: false, reason: "explicit_execute_required" };
  return dispatchAccountNotifications(accountNotificationConfiguration(env));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ error: /^kova_account_email_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "kova_account_email_dispatch_failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
