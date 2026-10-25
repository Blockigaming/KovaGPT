import { dispatchAuthEmailBatch } from "../../scripts/auth-email/dispatch.mjs";
import { dispatchAccountNotifications } from "../../scripts/auth-email/notification-dispatch.mjs";
import { parseAzureDirectPublicOrigin } from "./azure-direct-origin.server.mjs";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const MESSAGE = /^[A-Za-z0-9_-]{43}$/u;
const RECIPIENT = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u;
const fail = (code) => {
  throw new Error(`kova_email_worker_${code}`);
};
const PRODUCTION_ORIGIN = "https://kovagpt.com";
const DATABASE_ORIGIN = "https://mfbycmbjygcfkrsuepxf.supabase.co";
const RPCS = new Set([
  "kova_email_claim_worker_run",
  "kova_email_worker_scope",
  "kova_email_finish_worker_run",
  "kova_email_claim_account_dispatch",
  "kova_auth_claim_email_dispatch",
  "kova_auth_prepare_email_dispatch",
  "kova_auth_finish_email_dispatch",
  "account_email_claim_dispatch",
  "account_email_prepare_dispatch",
  "account_email_finish_dispatch",
]);

/** Exact production binding; independent from both staging-only dispatchers.
 * This is configuration, never proof of usable keys or authorization to deploy. */
export function productionEmailWorkerConfiguration(env = process.env) {
  if (env.KOVA_PRODUCTION_EMAIL_WORKER_ENABLED !== "true") fail("disabled");
  const originMode = env.KOVA_PRODUCTION_ORIGIN_MODE;
  const publicOrigin =
    originMode === undefined || originMode === "cloudflare"
      ? PRODUCTION_ORIGIN
      : originMode === "azure-direct"
        ? parseAzureDirectPublicOrigin(env)
        : null;
  if (
    !publicOrigin ||
    env.AZURE_ENVIRONMENT !== "production" ||
    env.CONTAINER_APP_NAME !== "kovagpt-prod-web" ||
    !["dual", "kova"].includes(env.KOVA_AUTH_MODE) ||
    env.KOVA_AUTH_PUBLIC_ORIGIN !== publicOrigin ||
    env.KOVA_AUTH_ORIGIN !== publicOrigin ||
    env.SUPABASE_URL !== DATABASE_ORIGIN ||
    env.KOVA_EXPECTED_SUPABASE_PROJECT_REF !== "mfbycmbjygcfkrsuepxf"
  )
    fail("target_invalid");
  const authEnabled = env.KOVA_AUTH_EMAIL_DISPATCH_ENABLED === "true";
  const accountEnabled = env.KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED === "true";
  if ((!authEnabled && !accountEnabled) || (authEnabled && env.KOVA_EMAIL_QUEUE_ENABLED !== "true"))
    fail("disabled");
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"])
    if (typeof env[name] !== "string" || env[name].length < 16 || /[\r\n]/u.test(env[name]))
      fail("private_configuration_missing");
  return {
    publicOrigin,
    databaseOrigin: DATABASE_ORIGIN,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    resendKey: env.RESEND_API_KEY,
    authEnabled,
    accountEnabled,
    maxSends: 1,
  };
}

export function createProductionEmailWorkerRpc(config, fetcher = fetch) {
  return async (name, args) => {
    if (!RPCS.has(name)) fail("rpc_invalid");
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
        body: JSON.stringify(args),
      });
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
            await reader.cancel();
            fail("database_unavailable");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok || data === null) fail("database_unavailable");
      return data;
    } catch {
      fail("database_unavailable");
    }
  };
}

function scopeConfiguration(scope, type, config, now) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) fail("scope_invalid");
  const allowed =
    type === "auth"
      ? ["messageIds", "recipients", "issuedNotBefore"]
      : ["eventIds", "issuedNotBefore"];
  if (
    Object.keys(scope).length !== allowed.length ||
    Object.keys(scope).some((key) => !allowed.includes(key))
  )
    fail("scope_invalid");
  const issued = Date.parse(scope.issuedNotBefore);
  if (
    !Number.isFinite(issued) ||
    issued > now ||
    issued < now - (type === "auth" ? 60 : 25 * 60) * 60_000
  )
    fail("scope_invalid");
  if (type === "auth") {
    if (
      !Array.isArray(scope.messageIds) ||
      scope.messageIds.length !== 1 ||
      !MESSAGE.test(scope.messageIds[0] ?? "") ||
      !Array.isArray(scope.recipients) ||
      scope.recipients.length !== 1 ||
      !RECIPIENT.test(scope.recipients[0] ?? "") ||
      scope.recipients[0] !== scope.recipients[0].toLowerCase() ||
      scope.recipients[0].length > 320
    )
      fail("scope_invalid");
  } else if (
    !Array.isArray(scope.eventIds) ||
    scope.eventIds.length !== 1 ||
    !UUID.test(scope.eventIds[0] ?? "")
  )
    fail("scope_invalid");
  return { ...config, maxSends: 1, ...scope, issuedNotBefore: new Date(issued).toISOString() };
}

/** No caller-selected account, recipient, event, batch size or deadline.
 * PostgreSQL selects bounded scope under the same durable invocation lease. */
export async function runProductionEmailWorker(
  run,
  config,
  {
    rpc = createProductionEmailWorkerRpc(config),
    dispatchAuth = dispatchAuthEmailBatch,
    dispatchAccount = dispatchAccountNotifications,
    send,
    now = Date.now,
  } = {},
) {
  if (!UUID.test(run?.runId ?? "") || typeof run?.issuedAt !== "string") fail("request_invalid");
  if (
    (await rpc("kova_email_claim_worker_run", {
      p_run_id: run.runId,
      p_issued_at: run.issuedAt,
    })) !== true
  )
    return { claimed: false, attempted: 0 };
  let summary;
  try {
    const scope = await rpc("kova_email_worker_scope", { p_run_id: run.runId });
    if (
      !scope ||
      typeof scope !== "object" ||
      Array.isArray(scope) ||
      !Object.hasOwn(scope, "auth") ||
      !Object.hasOwn(scope, "account")
    )
      fail("scope_invalid");
    // Validate BOTH scopes before any send. A malformed second scope cannot
    // authorize the first lane's provider request.
    const authConfig =
      config.authEnabled && scope.auth !== null
        ? scopeConfiguration(scope.auth, "auth", config, now())
        : null;
    const accountConfig =
      config.accountEnabled && scope.account !== null
        ? scopeConfiguration(scope.account, "account", config, now())
        : null;
    const authTransport = send ? { rpc, now, send } : { rpc, now };
    const accountRpc = (name, args) =>
      name === "account_email_claim_dispatch"
        ? rpc("kova_email_claim_account_dispatch", { p_run_id: run.runId })
        : rpc(name, args);
    const accountTransport = send ? { rpc: accountRpc, now, send } : { rpc: accountRpc, now };
    const auth = authConfig ? await dispatchAuth(authConfig, authTransport) : null;
    const account = accountConfig ? await dispatchAccount(accountConfig, accountTransport) : null;
    summary = {
      claimed: true,
      attempted: (auth?.attempted ?? 0) + (account?.attempted ?? 0),
      auth,
      account,
    };
  } finally {
    if ((await rpc("kova_email_finish_worker_run", { p_run_id: run.runId })) !== true)
      fail("completion_uncertain");
  }
  return summary;
}
