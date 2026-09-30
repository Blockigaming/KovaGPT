import assert from "node:assert/strict";
import test from "node:test";
import {
  S6Run,
  ORIGIN,
  TARGET,
  totp,
  validateWatchdog,
  reconcileChecks,
} from "../../scripts/release/s6-deployed-checks.mjs";
import { authDatabase, passwordAccount } from "../helpers/kova-auth-database.mjs";
import { authHttp, postgresTransport } from "../helpers/kova-auth-http.mjs";

test("TOTP runner matches RFC 6238 SHA1 vector at 59 seconds", () => {
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000), "287082");
});
test("live execution refuses stale, failed, wrong-target or oversized watchdog envelopes", () => {
  const now = Date.now();
  const good = {
    target: TARGET,
    status: "armed",
    selfTest: true,
    pid: 42,
    launcherPid: 41,
    heartbeatAt: new Date(now).toISOString(),
    deadlineEpoch: (now + 600000) / 1000,
    tokenExpires: new Date(now + 1800000).toISOString(),
  };
  assert.equal(validateWatchdog(good, now), now + 600000);
  for (const patch of [
    { status: "stop_failed" },
    { target: TARGET + "other" },
    { heartbeatAt: new Date(now - 9000).toISOString() },
    { pid: 41 },
    { deadlineEpoch: (now + 1201000) / 1000 },
    { tokenExpires: new Date(now + 600000).toISOString() },
  ])
    assert.throws(() => validateWatchdog({ ...good, ...patch }, now));
});
test("ledger never accepts source-only PASS or unknown checks", () => {
  assert.throws(() =>
    reconcileChecks(
      [],
      [{ check: "public_login_and_signup", status: "PASS", kind: "SOURCE" }],
      [],
      true,
    ),
  );
  assert.throws(() =>
    reconcileChecks([], [{ check: "startup", status: "PASS", kind: "DEPLOYED" }], [], true),
  );
  assert.equal(reconcileChecks([], [], [], true).verified, false);
});
test("public signup runner exercises real handler/store/SQL through verification, replay and login", async () => {
  const db = await authDatabase();
  let queued;
  const names = [
    "kova_auth_create_compatibility_principal",
    "kova_auth_delete_unused_compatibility_principal",
    "kova_auth_create_password_account",
    "kova_auth_consume_verification",
    "kova_auth_revoke_session",
    "kova_auth_password_lookup",
    "kova_auth_create_session",
    "kova_auth_resolve_session",
  ];
  const rpc = postgresTransport(db, names);
  const h = authHttp({
    env: {
      KOVA_AUTH_PUBLIC_ORIGIN: ORIGIN,
      KOVA_AUTH_ORIGIN: ORIGIN,
      KOVA_EMAIL_QUEUE_ENABLED: "true",
    },
    rpc: async (name, args) => {
      const r = await rpc(name, args);
      if (
        [
          "kova_auth_create_compatibility_principal",
          "kova_auth_delete_unused_compatibility_principal",
          "kova_auth_revoke_session",
        ].includes(name) &&
        r.data
      )
        return { data: r.data[0][name] };
      return r;
    },
  });
  const routes = {
    "/api/auth/signup": h.handleKovaSignup,
    "/api/auth/verify": h.handleKovaVerification,
    "/api/auth/login": h.handleKovaLogin,
  };
  const run = new S6Run({
    database: { json: () => queued },
    serviceKey: "fixture",
    apiKey: "fixture",
    deadline: Date.now() + 600000,
    sourceSha: "c".repeat(40),
    request: async (url, init) => {
      assert.equal(new URL(url).origin, ORIGIN);
      const r = await routes[new URL(url).pathname](new Request(url, init));
      const rows = await db.query(
        "select payload as message from public.test_email_queue order by id desc limit 1",
      );
      queued = rows.rows[0];
      return r;
    },
  });
  try {
    await run.signupCheck();
    assert.equal(run.records[0].status, "PASS");
    assert.equal(run.signupOwner.principal.emailVerified, true);
    assert.deepEqual(h.logs, []);
  } finally {
    await run.dispatcher.close();
    await db.close();
  }
});
test("fixture cleanup SQL disables only exact run identities and drains their proofs/queue", async () => {
  const db = await authDatabase({
    beforeMigrations: `create schema pgmq;create table pgmq.q_auth_emails(message jsonb);
    create table public.agent_jobs(owner_id uuid,input jsonb,status text);`,
  });
  const sql = [];
  const run = new S6Run({
    database: {
      query: (q) => sql.push(q),
      json: () => ({ sessions: 0, activeAccounts: 0, queued: 0 }),
    },
    serviceKey: "fixture",
    apiKey: "fixture",
    deadline: Date.now() + 600000,
    sourceSha: "c".repeat(40),
  });
  const f = run.fixture("signup");
  try {
    const fixture = await passwordAccount(db, {
      id: "10000000-0000-4000-8000-000000000009",
      email: f.email,
    });
    const unrelated = await passwordAccount(db, {
      id: "20000000-0000-4000-8000-000000000009",
      email: "unrelated@example.invalid",
      token: "unrelated-session",
    });
    await db.query("insert into pgmq.q_auth_emails(message) values($1),($2)", [
      { to: f.email },
      { to: "unrelated@example.invalid" },
    ]);
    await run.cleanup();
    assert.equal(run.cleanupComplete, true);
    // Parsing/executing against the real migrated schema catches schema drift
    // such as confusing account deleted_at with factor disabled_at.
    for (const q of sql) await db.exec(q);
    const accounts = (
      await db.query(
        "select id,deleted_at is not null as disabled from kova_private.auth_accounts order by id",
      )
    ).rows;
    assert.deepEqual(accounts, [
      { id: fixture.account_id, disabled: true },
      { id: unrelated.account_id, disabled: false },
    ]);
    assert.deepEqual((await db.query("select message from pgmq.q_auth_emails")).rows, [
      { message: { to: "unrelated@example.invalid" } },
    ]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from kova_private.auth_sessions where account_id=$1 and revoked_at is null",
          [unrelated.account_id],
        )
      ).rows[0].n,
      1,
    );
    assert.ok(sql.every((q) => q.includes(f.email)));
    assert.ok(sql.every((q) => !q.includes("truncate")));
  } finally {
    await run.dispatcher.close();
    await db.close();
  }
});
test("Google fixture preflight refuses existing owned or hosted identities", async () => {
  for (const counts of [
    { existingAccounts: 1, existingHostedUsers: 0 },
    { existingAccounts: 0, existingHostedUsers: 1 },
  ]) {
    const run = new S6Run({
      database: { json: () => counts },
      serviceKey: "fixture",
      apiKey: "fixture",
      deadline: Date.now() + 600000,
      sourceSha: "c".repeat(40),
    });
    try {
      assert.throws(() => run.prepareOwner("owner@example.invalid"));
      assert.equal(run.fixtures.length, 0);
    } finally {
      await run.dispatcher.close();
    }
  }
});
test("rollback restores pinned dual even when a pure-Kova authority assertion fails", async () => {
  const run = new S6Run({
    database: {},
    serviceKey: "fixture",
    apiKey: "fixture",
    deadline: Date.now() + 900000,
    sourceSha: "c".repeat(40),
  });
  let phase = "dual";
  const transitions = [];
  run.signupOwner = {};
  run.retiredEvidence = { hosted: "hosted", owned: "revoked", cookie: "revoked-cookie" };
  run.login = async () => {};
  run.token = async () => "valid";
  run.app = async (path) =>
    path === "/api/version"
      ? {
          status: 200,
          data: {
            sha: phase === "restored" ? "c92fdbfea58a0917f34c25264d7b8b40a78a47fb" : run.sourceSha,
          },
        }
      : { status: 200, data: { isError: true } };
  run.bearer = async (_path, token) => ({
    status: token === "valid" ? 200 : phase === "kova" ? 200 : 401,
  });
  try {
    await assert.rejects(
      run.rollbackCheck(async (action) => {
        transitions.push(action);
        phase = action === "switch-kova" ? "kova" : "restored";
        return {
          mode: phase === "kova" ? "kova" : "dual",
          compiledMode: phase === "kova" ? "kova" : "dual",
        };
      }),
    );
    assert.deepEqual(transitions, ["switch-kova", "restore"]);
    assert.equal(run.rollbackRestored, true);
    assert.equal(run.records.length, 0);
  } finally {
    await run.dispatcher.close();
  }
});
