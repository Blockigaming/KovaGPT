import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { makeAccountLifecycleHandlers } from "../../src/lib/account-lifecycle-handlers.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const WORKER_SECRET = "nonsecret-worker-fixture-".repeat(3);
const active = { state: "active", scheduledAt: null, recoverUntil: null };
const scheduledAt = new Date().toISOString();
const scheduled = {
  state: "scheduled",
  scheduledAt,
  recoverUntil: new Date(Date.parse(scheduledAt) + 30 * 86400000).toISOString(),
};

function publicFixture({
  provider = "supabase",
  failure = false,
  authenticated = true,
  notificationFailure = false,
} = {}) {
  const calls = [];
  let state = active;
  const admin = {
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal: async (signal) => {
          assert.ok(signal instanceof AbortSignal);
          if (failure) return { error: new Error("private upstream transport detail"), data: null };
          if (name === "account_email_record_lifecycle") {
            return notificationFailure
              ? { error: new Error("private mail queue detail"), data: null }
              : { data: "33333333-3333-4333-8333-333333333333", error: null };
          }
          if (name === "kova_policy_schedule_deletion") state = scheduled;
          if (name === "kova_policy_recover_deletion") state = active;
          return { data: state, error: null };
        },
      };
    },
  };
  const handlers = makeAccountLifecycleHandlers({
    authenticate: async () =>
      authenticated
        ? { userId: OWNER, authProvider: provider, supabaseAdmin: admin }
        : Response.json({ error: "Unauthorized" }, { status: 401 }),
  });
  const request = (
    method,
    body,
    { owner = OWNER, origin = "https://kova.example", contentType = "application/json" } = {},
  ) =>
    new Request("https://kova.example/api/account", {
      method,
      headers: { "X-Kova-Expected-User": owner, Origin: origin, "Content-Type": contentType },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return {
    calls,
    run: (method, body, options) => handlers[method]({ request: request(method, body, options) }),
  };
}

test("public scheduling confirms policy before an owner-derived notice and returns recoverable 202", async () => {
  const f = publicFixture();
  const response = await f.run("DELETE", { confirmation: "DELETE" });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.deepEqual(body, {
    ...scheduled,
    accountId: OWNER,
    billingChanged: false,
    emailNotification: "queued",
  });
  assert.deepEqual(
    f.calls.map(({ name }) => name),
    [
      "kova_policy_schedule_deletion",
      "kova_policy_account_status",
      "account_email_record_lifecycle",
    ],
  );
  assert.deepEqual(f.calls[0].args, { p_user: OWNER });
  assert.equal(f.calls[2].args.p_account_id, OWNER);
  assert.equal(f.calls[2].args.p_event_type, "account_deletion_scheduled");
  assert.equal(Object.hasOwn(f.calls[2].args, "recipient"), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("public recovery preserves the same account and delegates deadline authority to its RPC", async () => {
  const f = publicFixture();
  await f.run("DELETE", { confirmation: "DELETE" });
  const response = await f.run("PATCH", { action: "recover" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...active,
    accountId: OWNER,
    billingChanged: false,
    emailNotification: "queued",
  });
  assert.deepEqual(f.calls.at(-2), {
    name: "kova_policy_recover_deletion",
    args: { p_user: OWNER },
  });
  assert.equal(f.calls.at(-1).args.p_event_type, "account_recovered");
  assert.equal(
    f.calls.some(({ name }) => /begin_finalization|confirm_finalization|retir/.test(name)),
    false,
  );
});

test("notification uncertainty does not replay deletion or misreport its confirmed policy result", async () => {
  const f = publicFixture({ notificationFailure: true });
  const response = await f.run("DELETE", { confirmation: "DELETE" });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).emailNotification, "unconfirmed");
  assert.equal(f.calls.filter(({ name }) => name === "kova_policy_schedule_deletion").length, 1);
});

test("GET returns owner-bound state without starting cleanup or recovery", async () => {
  const f = publicFixture();
  const response = await f.run("GET");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...active, accountId: OWNER, billingChanged: false });
  assert.deepEqual(f.calls, [{ name: "kova_policy_account_status", args: { p_user: OWNER } }]);
});

test("public lifecycle rejects missing authority, different owners and future owned Auth without RPCs", async () => {
  for (const [options, requestOptions, status] of [
    [{ authenticated: false }, {}, 401],
    [{ provider: "kova" }, {}, 503],
    [{ provider: null }, {}, 503],
    [{}, { owner: "another-owner" }, 409],
  ]) {
    const f = publicFixture(options);
    assert.equal(
      (await f.run("DELETE", { confirmation: "DELETE" }, requestOptions)).status,
      status,
    );
    assert.deepEqual(f.calls, []);
  }
});

test("cross-site, missing confirmation and oversized lifecycle bodies cannot reach policy RPCs", async () => {
  for (const [method, body, options, status] of [
    ["DELETE", { confirmation: "DELETE" }, { origin: "https://other.example" }, 403],
    ["DELETE", { confirmation: "NO" }, {}, 400],
    ["PATCH", { action: "delete" }, {}, 400],
    ["DELETE", { confirmation: "DELETE" }, { contentType: "text/plain" }, 415],
    ["DELETE", "x".repeat(1025), {}, 413],
  ]) {
    const f = publicFixture();
    assert.equal((await f.run(method, body, options)).status, status);
    assert.deepEqual(f.calls, []);
  }
});

test("unknown scheduling/recovery outcomes do not claim completion or leak upstream details", async () => {
  for (const [method, body, status] of [
    ["DELETE", { confirmation: "DELETE" }, 503],
    ["PATCH", { action: "recover" }, 409],
  ]) {
    const f = publicFixture({ failure: true });
    const response = await f.run(method, body);
    assert.equal(response.status, status);
    const text = await response.text();
    assert.match(text, /"state":"unknown"/);
    assert.doesNotMatch(text, /private upstream|completed|canceled subscriptions/);
  }
});

async function loadTs(path, mocks) {
  const key = crypto.randomUUID();
  globalThis[key] = mocks;
  const source = stripTypeScriptTypes(await readFile(path, "utf8")).replace(
    /^import[\s\S]*?;\n/gmu,
    "",
  );
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(`const {${Object.keys(mocks).join(",")}}=globalThis[${JSON.stringify(key)}];\n${source}`).toString("base64")}#${key}`
    );
  } finally {
    delete globalThis[key];
  }
}

async function workerRouteFixture({ secret = WORKER_SECRET, failBatch = false } = {}) {
  const calls = [],
    envNames = [];
  const { Route } = await loadTs("src/routes/api/internal/account-deletions.ts", {
    createFileRoute: () => (configuration) => configuration,
    timingSafeEqualText: (supplied, expected) => supplied === expected,
    runtimeEnv: (name) => {
      envNames.push(name);
      return name === "ACCOUNT_DELETION_WORKER_SECRET" ? secret : undefined;
    },
    runAccountDeletionBatch: async (...args) => {
      calls.push(args);
      if (failBatch) throw new Error("private worker transport detail");
      return { attempted: 0, completed: 0, pending: 0 };
    },
  });
  return {
    calls,
    envNames,
    Route,
    run: ({ token = WORKER_SECRET, body, headers = {} } = {}) =>
      Route.server.handlers.POST({
        request: new Request("https://kova.example/api/internal/account-deletions", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, ...headers },
          ...(body === undefined ? {} : { body }),
        }),
      }),
  };
}

test("internal worker requires its dedicated configured credential without scheduler-key fallback", async () => {
  for (const options of [{ secret: undefined }, { secret: "short" }]) {
    const f = await workerRouteFixture({ ...options, secret: options.secret ?? null });
    assert.equal((await f.run()).status, 503);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.envNames, ["ACCOUNT_DELETION_WORKER_SECRET"]);
  }
  const wrong = await workerRouteFixture();
  assert.equal((await wrong.run({ token: "wrong" })).status, 401);
  assert.deepEqual(wrong.calls, []);
});

test("worker rejects caller payloads even when content-length is absent or falsely zero", async () => {
  for (const headers of [{}, { "Content-Length": "0" }, { "Content-Length": "2" }]) {
    const f = await workerRouteFixture();
    assert.equal((await f.run({ body: "{}", headers })).status, 400);
    assert.deepEqual(f.calls, []);
  }
});

test("authorized empty worker request invokes one fixed batch and reports only sanitized counts", async () => {
  const f = await workerRouteFixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [[]]);
  assert.deepEqual(await response.json(), { ok: true, attempted: 0, completed: 0, pending: 0 });
  assert.equal(f.Route.server.handlers.GET, undefined);
});

test("worker failures neither leak raw errors nor claim successful deletion", async () => {
  const f = await workerRouteFixture({ failBatch: true });
  const response = await f.run();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private worker transport detail|"completed":/);
});

test("server worker adapter uses one service-only due batch without retaining user bearer tokens", async () => {
  const calls = [],
    admin = {},
    claim = { state: "finalizing", attemptId: ATTEMPT, customers: [] };
  let finalizerActor;
  const { runAccountDeletionBatch } = await loadTs("src/lib/account-deletion-worker.server.ts", {
    supabaseAdmin: admin,
    requireMonthlyIntroReadiness: async (actual) => {
      assert.equal(actual, admin);
      calls.push("readiness");
    },
    createStripeClient: (environment) => ({ environment }),
    reconcileAccountMonthlyIntroCheckout: async (options) => {
      assert.equal(options.supabase, admin);
      assert.equal(options.userId, OWNER);
      assert.equal(options.stripeFactory("sandbox").environment, "sandbox");
      calls.push("reconcile-only");
    },
    runAccountPolicyFinalizerBatch: async (options) => {
      assert.equal(options.admin, admin);
      assert.equal(options.limit, 1);
      await options.reconcileCheckout(OWNER);
      await options.finalize(OWNER, claim);
      return { attempted: 1, completed: 1, pending: 0 };
    },
    finalizeAccountAfterRecovery: async (actor, actualClaim) => {
      finalizerActor = actor;
      assert.equal(actualClaim, claim);
      calls.push("claimed-finalizer");
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(await runAccountDeletionBatch(), { attempted: 1, completed: 1, pending: 0 });
  assert.deepEqual(calls, ["readiness", "reconcile-only", "claimed-finalizer"]);
  assert.equal(finalizerActor.userId, OWNER);
  assert.equal(finalizerActor.authProvider, "supabase");
  assert.equal(finalizerActor.supabaseAdmin, admin);
  assert.deepEqual(finalizerActor.claims, { sub: OWNER, actor: "account-deletion-worker" });
  assert.equal("access_token" in finalizerActor, false);
});
