import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderKovaAuthEmail } from "../../src/lib/kova-auth-email.server.mjs";
import {
  productionEmailWorkerConfiguration,
  runProductionEmailWorker,
  createProductionEmailWorkerRpc,
} from "../../src/lib/kova-email-worker.server.mjs";
import { invokeProductionEmailWorker, main } from "../../scripts/auth-email/production-worker.mjs";
import { authenticateEmailWorkerRequest } from "../../src/lib/kova-email-worker-auth.server.mjs";
const at = Date.parse("2026-10-21T12:00:00.000Z");
const run = { runId: "10000000-0000-4000-8000-000000000001", issuedAt: new Date(at).toISOString() };
const env = () => ({
  KOVA_PRODUCTION_EMAIL_WORKER_ENABLED: "true",
  AZURE_ENVIRONMENT: "production",
  CONTAINER_APP_NAME: "kovagpt-prod-web",
  KOVA_AUTH_MODE: "kova",
  KOVA_AUTH_PUBLIC_ORIGIN: "https://kovagpt.com",
  KOVA_AUTH_ORIGIN: "https://kovagpt.com",
  SUPABASE_URL: "https://mfbycmbjygcfkrsuepxf.supabase.co",
  KOVA_EXPECTED_SUPABASE_PROJECT_REF: "mfbycmbjygcfkrsuepxf",
  KOVA_EMAIL_QUEUE_ENABLED: "true",
  KOVA_AUTH_EMAIL_DISPATCH_ENABLED: "true",
  KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED: "true",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key-only",
  RESEND_API_KEY: "synthetic-resend-key-only",
});
const directOrigin = "https://kovagpt-prod-web.review.eastus.azurecontainerapps.io";
const directEnv = () => ({
  ...env(),
  KOVA_PRODUCTION_ORIGIN_MODE: "azure-direct",
  KOVA_AZURE_PUBLIC_ORIGIN: directOrigin,
  KOVA_AUTH_PUBLIC_ORIGIN: directOrigin,
  KOVA_AUTH_ORIGIN: directOrigin,
});
const scope = () => ({
  auth: {
    messageIds: ["m".repeat(43)],
    recipients: ["owner@example.test"],
    issuedNotBefore: new Date(at - 59 * 60_000).toISOString(),
  },
  account: {
    eventIds: [run.runId],
    issuedNotBefore: new Date(at - 14 * 60_000).toISOString(),
  },
});
function dependencies({
  claim = true,
  selected = scope(),
  finish = true,
  authFailure = false,
} = {}) {
  const calls = [];
  return {
    calls,
    now: () => at,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "kova_email_claim_worker_run") return claim;
      if (name === "kova_email_worker_scope") return selected;
      if (name === "kova_email_finish_worker_run") return finish;
      assert.fail("Unexpected RPC");
    },
    dispatchAuth: async (config) => {
      calls.push(["auth", config]);
      if (authFailure) throw new Error("private transport details");
      return { attempted: 1, sent: 1 };
    },
    dispatchAccount: async (config) => {
      calls.push(["account", config]);
      return { attempted: 1, sent: 1 };
    },
  };
}
test("production dispatch is default off and binds exact app, origin, project and private slots", () => {
  assert.throws(() => productionEmailWorkerConfiguration({}), /disabled/);
  const config = productionEmailWorkerConfiguration(env());
  assert.equal(config.maxSends, 1);
  for (const [key, value] of [
    ["AZURE_ENVIRONMENT", "staging"],
    ["CONTAINER_APP_NAME", "ca-kovagpt-staging"],
    ["KOVA_AUTH_PUBLIC_ORIGIN", "https://www.kovagpt.com"],
    ["KOVA_AUTH_ORIGIN", "https://other.test"],
    ["SUPABASE_URL", "https://oztdrjtdglkizlewnulh.supabase.co"],
    ["KOVA_EXPECTED_SUPABASE_PROJECT_REF", "oztdrjtdglkizlewnulh"],
    ["KOVA_AUTH_MODE", "supabase"],
    ["KOVA_EMAIL_QUEUE_ENABLED", "false"],
    ["RESEND_API_KEY", "short"],
  ])
    assert.throws(
      () => productionEmailWorkerConfiguration({ ...env(), [key]: value }),
      /kova_email_worker_/,
    );
});
test("worker uses only database-selected one-record scopes and finalizes its exact run", async () => {
  const d = dependencies();
  const result = await runProductionEmailWorker(run, productionEmailWorkerConfiguration(env()), d);
  assert.deepEqual(result, {
    claimed: true,
    attempted: 2,
    auth: { attempted: 1, sent: 1 },
    account: { attempted: 1, sent: 1 },
  });
  assert.deepEqual(
    d.calls.map(([name]) => name),
    [
      "kova_email_claim_worker_run",
      "kova_email_worker_scope",
      "auth",
      "account",
      "kova_email_finish_worker_run",
    ],
  );
  assert.deepEqual(d.calls[0][1], { p_run_id: run.runId, p_issued_at: run.issuedAt });
  assert.equal(d.calls[2][1].maxSends, 1);
  assert.equal(d.calls[3][1].maxSends, 1);
  assert.doesNotMatch(JSON.stringify(result), /synthetic|owner@example/);
});
test("replay or concurrent claim rejection performs no reads, sends or finish", async () => {
  const d = dependencies({ claim: false });
  assert.deepEqual(
    await runProductionEmailWorker(run, productionEmailWorkerConfiguration(env()), d),
    { claimed: false, attempted: 0 },
  );
  assert.equal(d.calls.length, 1);
});
test("empty queues do not send; disabled notification lane cannot send", async () => {
  const d = dependencies({ selected: { auth: null, account: null } });
  assert.equal(
    (await runProductionEmailWorker(run, productionEmailWorkerConfiguration(env()), d)).attempted,
    0,
  );
  assert.equal(d.calls.length, 3);
  const e = dependencies();
  const config = productionEmailWorkerConfiguration({
    ...env(),
    KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED: "false",
  });
  assert.equal((await runProductionEmailWorker(run, config, e)).attempted, 1);
  assert.equal(
    e.calls.some(([name]) => name === "account"),
    false,
  );
});
test("malformed or injected second scope prevents all sends and releases the run", async () => {
  for (const bad of [
    { eventIds: ["bad"], issuedNotBefore: run.issuedAt },
    { ...scope().account, maxSends: 500 },
    { ...scope().account, resendKey: "foreign" },
    { ...scope().account, issuedNotBefore: new Date(at - 26 * 3600_000).toISOString() },
  ]) {
    const d = dependencies({ selected: { ...scope(), account: bad } });
    await assert.rejects(
      runProductionEmailWorker(run, productionEmailWorkerConfiguration(env()), d),
      /scope_invalid/,
    );
    assert.deepEqual(
      d.calls.map(([name]) => name),
      ["kova_email_claim_worker_run", "kova_email_worker_scope", "kova_email_finish_worker_run"],
    );
  }
});
test("send uncertainty does not retry or enter the other lane; release uncertainty fails closed", async () => {
  const d = dependencies({ authFailure: true });
  await assert.rejects(
    runProductionEmailWorker(run, productionEmailWorkerConfiguration(env()), d),
    /private transport/,
  );
  assert.equal(d.calls.filter(([name]) => name === "auth").length, 1);
  assert.equal(
    d.calls.some(([name]) => name === "account"),
    false,
  );
  assert.equal(d.calls.at(-1)[0], "kova_email_finish_worker_run");
  await assert.rejects(
    runProductionEmailWorker(
      run,
      productionEmailWorkerConfiguration(env()),
      dependencies({ finish: false }),
    ),
    /completion_uncertain/,
  );
});
test("worker RPC transport rejects unlisted operations, redirects and raw provider errors", async () => {
  let calls = 0;
  const config = productionEmailWorkerConfiguration(env());
  const rpc = createProductionEmailWorkerRpc(config, async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ private: "synthetic-resend-key-only" }, { status: 503 });
  });
  await assert.rejects(rpc("delete_everything", {}), /rpc_invalid/);
  assert.equal(calls, 0);
  await assert.rejects(
    rpc("kova_email_worker_scope", {}),
    (error) => error.message === "kova_email_worker_database_unavailable",
  );
  assert.equal(calls, 1);
});
test("operator defaults off and emits one signed exact-origin empty-body request without retries", async () => {
  assert.equal((await main([], {})).execution_enabled, false);
  let calls = 0;
  assert.equal(
    (
      await invokeProductionEmailWorker({
        env: {},
        fetcher: () => {
          throw new Error();
        },
      })
    ).execution_enabled,
    false,
  );
  const secret = "synthetic-dedicated-worker-secret-123456789";
  const output = await invokeProductionEmailWorker({
    env: { KOVA_EMAIL_WORKER_OPERATOR_ENABLED: "true", KOVA_EMAIL_WORKER_SECRET: secret },
    now: () => at,
    newId: () => run.runId,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, "https://kovagpt.com/api/internal/email-dispatch");
      assert.equal(options.redirect, "error");
      assert.equal(options.body, "{}");
      assert.deepEqual(
        authenticateEmailWorkerRequest(
          new Request(url, options),
          { KOVA_EMAIL_WORKER_SECRET: secret },
          at,
        ),
        run,
      );
      return Response.json({ ok: true, claimed: true, attempted: 2, private: secret });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(output, { ok: true, claimed: true, attempted: 2, runId: run.runId });
  assert.doesNotMatch(JSON.stringify(output), /secret/);
});

for (const originMode of ["cloudflare", "azure-direct"]) {
  test(`production worker reaches both branded dispatch pipelines (${originMode})`, async () => {
    const configuredEnv = originMode === "azure-direct" ? directEnv() : env();
    const publicOrigin = configuredEnv.KOVA_AUTH_PUBLIC_ORIGIN;
    const token = "t".repeat(43),
      queuedAt = new Date(at - 60_000).toISOString();
    const label = "kova-auth-verification";
    const rendered = renderKovaAuthEmail({
      label,
      recipient: "owner@example.test",
      link: `${publicOrigin}/api/auth/verify?token=${token}`,
      publicOrigin,
      issuedAt: queuedAt,
      expiresAt: new Date(at - 60_000 + 3600_000).toISOString(),
    });
    const payload = {
      message_id: "m".repeat(43),
      to: "owner@example.test",
      from: "KovaGPT <noreply@kovagpt.com>",
      sender_domain: "notify.kovagpt.com",
      ...rendered,
      purpose: "auth",
      label,
      idempotency_key: `${label}:${createHash("sha256").update(token).digest("hex")}`,
      queued_at: queuedAt,
    };
    const calls = [];
    const rpc = async (name) => {
      calls.push(name);
      if (name === "kova_email_worker_scope") return scope();
      if (name === "kova_auth_claim_email_dispatch")
        return [
          {
            queue_id: 42,
            attempt: 1,
            lease_expires_at: new Date(at + 60_000).toISOString(),
            payload,
          },
        ];
      if (name === "kova_email_claim_account_dispatch")
        return [
          {
            id: run.runId,
            event_type: "password_changed",
            recipient: "owner@example.test",
            occurred_at: queuedAt,
            metadata: {},
            lease_token: run.runId,
            lease_expires_at: new Date(at + 120_000).toISOString(),
          },
        ];
      return true;
    };
    const result = await runProductionEmailWorker(
      run,
      productionEmailWorkerConfiguration(configuredEnv),
      {
        rpc,
        now: () => at,
        send: async (_payload, body) => {
          calls.push("send");
          assert.equal(body.from, "KovaGPT <noreply@kovagpt.com>");
          assert.deepEqual(body.to, ["owner@example.test"]);
          return { outcome: "sent", providerId: run.runId };
        },
      },
    );
    assert.equal(result.attempted, 2);
    assert.equal(result.auth.sent, 1);
    assert.equal(result.account.sent, 1);
    assert.deepEqual(calls, [
      "kova_email_claim_worker_run",
      "kova_email_worker_scope",
      "kova_auth_claim_email_dispatch",
      "kova_auth_prepare_email_dispatch",
      "send",
      "kova_auth_finish_email_dispatch",
      "kova_email_claim_account_dispatch",
      "account_email_prepare_dispatch",
      "send",
      "account_email_finish_dispatch",
      "kova_email_finish_worker_run",
    ]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
  });
}

test("direct Azure worker configuration pins the exact app origin and rejects conflicting targets", () => {
  assert.equal(productionEmailWorkerConfiguration(directEnv()).publicOrigin, directOrigin);
  for (const change of [
    { KOVA_PRODUCTION_ORIGIN_MODE: "unknown" },
    { KOVA_PRODUCTION_ORIGIN_MODE: "" },
    { KOVA_AZURE_PUBLIC_ORIGIN: "http://kovagpt-prod-web.review.eastus.azurecontainerapps.io" },
    { KOVA_AZURE_PUBLIC_ORIGIN: `${directOrigin}/path` },
    { KOVA_AZURE_PUBLIC_ORIGIN: "https://foreign-app.review.eastus.azurecontainerapps.io" },
    { KOVA_AZURE_PUBLIC_ORIGIN: "https://kovagpt-prod-web.attacker.test" },
    { CONTAINER_APP_NAME: "foreign-app" },
    { KOVA_AUTH_ORIGIN: "https://kovagpt.com" },
    { KOVA_AUTH_PUBLIC_ORIGIN: "https://kovagpt.com" },
    { AZURE_ENVIRONMENT: "staging" },
  ])
    assert.throws(
      () => productionEmailWorkerConfiguration({ ...directEnv(), ...change }),
      /target_invalid/,
    );
});

test("direct Azure scheduler sends exactly one signed request to the configured production app", async () => {
  const secret = "synthetic-dedicated-worker-secret-123456789";
  const operator = {
    ...directEnv(),
    KOVA_EMAIL_WORKER_OPERATOR_ENABLED: "true",
    KOVA_EMAIL_WORKER_SECRET: secret,
  };
  let calls = 0;
  const output = await invokeProductionEmailWorker({
    env: operator,
    now: () => at,
    newId: () => run.runId,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, `${directOrigin}/api/internal/email-dispatch`);
      assert.equal(options.redirect, "error");
      assert.equal(options.body, "{}");
      assert.deepEqual(
        authenticateEmailWorkerRequest(
          new Request(url, options),
          { KOVA_EMAIL_WORKER_SECRET: secret },
          at,
        ),
        run,
      );
      return Response.json({ ok: true, claimed: true, attempted: 0 });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(output, { ok: true, claimed: true, attempted: 0, runId: run.runId });
  for (const change of [
    { KOVA_PRODUCTION_ORIGIN_MODE: "unknown" },
    { KOVA_PRODUCTION_ORIGIN_MODE: "" },
    { KOVA_AZURE_PUBLIC_ORIGIN: `${directOrigin}/path` },
    { KOVA_AZURE_PUBLIC_ORIGIN: "https://foreign-app.review.eastus.azurecontainerapps.io" },
    { CONTAINER_APP_NAME: "foreign-app" },
    { AZURE_ENVIRONMENT: "staging" },
  ]) {
    await assert.rejects(
      invokeProductionEmailWorker({
        env: { ...operator, ...change },
        fetcher: async () => {
          calls++;
          throw new Error("must not fetch");
        },
      }),
      (error) => error.message === "kova_email_worker_invocation_unconfirmed",
    );
  }
  assert.equal(calls, 1);
});

test("direct Azure custom canonical keeps worker and scheduler on the single configured origin", async () => {
  const configured = {
    ...directEnv(),
    KOVA_AZURE_CUSTOM_PUBLIC_ORIGIN: "https://kovagpt.com",
    KOVA_AUTH_PUBLIC_ORIGIN: "https://kovagpt.com",
    KOVA_AUTH_ORIGIN: "https://kovagpt.com",
    KOVA_EMAIL_WORKER_OPERATOR_ENABLED: "true",
    KOVA_EMAIL_WORKER_SECRET: "synthetic-dedicated-worker-secret-123456789",
  };
  assert.equal(productionEmailWorkerConfiguration(configured).publicOrigin, "https://kovagpt.com");
  for (const change of [
    { KOVA_AUTH_PUBLIC_ORIGIN: directOrigin },
    { KOVA_AUTH_ORIGIN: directOrigin },
    { KOVA_AZURE_CUSTOM_PUBLIC_ORIGIN: "https://www.kovagpt.com" },
    { KOVA_AZURE_PUBLIC_ORIGIN: undefined },
  ])
    assert.throws(
      () => productionEmailWorkerConfiguration({ ...configured, ...change }),
      /target_invalid/,
    );
  const calls = [];
  await invokeProductionEmailWorker({
    env: configured,
    now: () => at,
    newId: () => run.runId,
    fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "error");
      assert.ok(options.headers["X-Kova-Email-Signature"]);
      return Response.json({ ok: true, claimed: false, attempted: 0 });
    },
  });
  assert.deepEqual(calls, ["https://kovagpt.com/api/internal/email-dispatch"]);
});
