import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { transformSync } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import { S6Run, ORIGIN, totp } from "../../scripts/release/s6-deployed-checks.mjs";
import { loadRealtimeLifecycle } from "../../scripts/release/s6-realtime-probe.mjs";
import { authDatabase, owner } from "../helpers/kova-auth-database.mjs";
import { authHttp, postgresTransport } from "../helpers/kova-auth-http.mjs";
import * as crypto from "../../src/lib/kova-auth-crypto.server.mjs";

const runFixture = (database = {}) =>
  new S6Run({
    database,
    serviceKey: "test",
    apiKey: "test",
    deadline: Date.now() + 1000000,
    sourceSha: "5f8cdcf059643a2fa82257ef97773c87448f70d1",
  });

test("pinned legacy enrollment reproduces 503 without adoption; corrected fixture completes migration and retirement", async () => {
  const db = await authDatabase();
  const run = runFixture();
  const email = `s6-${run.runId}-legacy@example.invalid`;
  const jwt = "test-header.test-payload.test-signature";
  const key = randomBytes(32);
  const env = {
    KOVA_AUTH_ENCRYPTION_KEY: key.toString("base64url"),
    KOVA_AUTH_ENCRYPTION_KEY_SHA256: createHash("sha256").update(key).digest("hex"),
  };
  const rpcNames = [
    "kova_auth_has_verified_legacy_mfa",
    "kova_auth_legacy_mfa_migration_status",
    "kova_auth_begin_legacy_mfa_migration",
    "kova_auth_read_legacy_mfa_migration",
    "kova_auth_activate_legacy_mfa_migration",
  ];
  const transport = postgresTransport(db, rpcNames);
  const rpc = async (name, args) => {
    const r = await transport(name, args);
    return name === "kova_auth_has_verified_legacy_mfa" && r.data ? { data: r.data[0][name] } : r;
  };
  const h = authHttp({
    mode: "dual",
    env: { KOVA_AUTH_PUBLIC_ORIGIN: ORIGIN },
    rpc,
    crypto: {
      encryptKovaSecret: (x) => crypto.encryptKovaSecret(x, env),
      decryptKovaSecret: (x) => crypto.decryptKovaSecret(x, env),
    },
    modules: {
      "@/integrations/supabase/client.server": {
        supabaseAdmin: {
          rpc,
          auth: {
            getUser: async () => ({
              data: { user: { id: owner, email, email_confirmed_at: new Date().toISOString() } },
            }),
            getClaims: async () => ({
              data: { claims: { sub: owner, role: "authenticated", aal: "aal2" } },
            }),
          },
        },
      },
    },
  });
  const request = (body, path = "enroll") =>
    new Request(ORIGIN + "/api/auth/mfa/" + path, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        "X-Kova-Owner": owner,
      },
      body: JSON.stringify(body),
    });
  try {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,now(),'test')",
      [owner, email],
    );
    await db.query("insert into auth.mfa_factors values(gen_random_uuid(),$1,'verified')", [owner]);
    await db.query("insert into auth.sessions values(gen_random_uuid(),$1)", [owner]);
    const body = { legacyMigration: true, newPassword: "test-only-strong-random-password!123" };
    const before = await h.handleKovaMfaEnroll(request(body));
    assert.equal(before.status, 503); // The old runner's next.status === 200 assertion.
    assert.equal((await before.json()).error, "Two-factor migration could not start.");
    // Obtain the exact new fixture SQL from the real runner, without network I/O.
    let mapping;
    run.db = {
      query: (sql) => {
        mapping = sql;
        throw new Error("captured_fixture_sql");
      },
    };
    run.fixture = () => ({ id: owner, email, password: body.newPassword });
    run.service = async () => ({ status: 200, data: { id: owner } });
    run.bearer = async (path) => ({
      status: 200,
      data: {
        access_token: jwt,
        id: owner,
        totp: { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
      },
    });
    await assert.rejects(run.legacyCheck(), /captured_fixture_sql/);
    await db.exec(mapping);
    const enrolled = await h.handleKovaMfaEnroll(request(body));
    assert.equal(enrolled.status, 200);
    const factor = await enrolled.json();
    const activated = await h.handleKovaMfaVerify(
      request(
        { legacyMigration: true, factorId: factor.factorId, code: totp(factor.secret) },
        "verify",
      ),
    );
    assert.equal(activated.status, 200);
    assert.equal((await activated.json()).session.assuranceLevel, "aal2");
    const state = (
      await db.query(
        `select
      exists(select 1 from kova_private.auth_legacy_retirements where account_id=$1) as retired,
      (select count(*)::int from auth.sessions where user_id=$1) as sessions`,
        [owner],
      )
    ).rows[0];
    assert.deepEqual(state, { retired: true, sessions: 0 });
  } finally {
    await run.dispatcher.close();
    await db.close();
  }
});

test("pinned Storage fixture insert is rejected by the real agent-runtime trigger", async () => {
  const db = new PGlite();
  try {
    const source = readFileSync(
      "supabase/migrations/20260801235959_agent_runtime_event_schema_compatibility.sql",
      "utf8",
    );
    const fn = source.match(
      /create or replace function public\.enforce_supported_agent_job_kind\(\)[\s\S]*?\$\$;/,
    )[0];
    await db.exec(`create table public.agent_jobs(id uuid,owner_id uuid,kind text,status text,input jsonb); ${fn}
      create trigger enforce_supported_agent_job_kind before insert on public.agent_jobs for each row execute function public.enforce_supported_agent_job_kind();`);
    await assert.rejects(
      db.exec(
        `insert into public.agent_jobs values(gen_random_uuid(),gen_random_uuid(),'team','cancelled','{}')`,
      ),
      /Agent runtime unavailable/,
    );
  } finally {
    await db.close();
  }
});

test("esbuild production lifecycle loads with CommonJS module.exports and no external transport", () => {
  const source = transformSync(readFileSync("src/lib/kova-auth-realtime.ts", "utf8"), {
    loader: "ts",
    format: "cjs",
    target: "node22",
  }).code;
  const loaded = loadRealtimeLifecycle(source, { require: () => ({}), setTimeout, clearTimeout });
  assert.equal(typeof loaded.subscribeOwnedRealtime, "function");
});

test("failure receipts retain step and numeric assertion without secrets or arbitrary messages", async () => {
  const run = runFixture();
  try {
    await run.check("legacy_mfa_bridge", () => {
      run.stage = "legacy_owned_enroll";
      run.lastHttpStatus = 503;
      assert.equal(503, 200, "DO-NOT-RETAIN-token-or-email");
    });
    assert.equal(run.records[0].stage, "legacy_owned_enroll");
    assert.equal(run.records[0].actual, 503);
    assert.equal(run.records[0].expected, 200);
    assert.ok(!JSON.stringify(run.records).includes("DO-NOT-RETAIN"));
  } finally {
    await run.dispatcher.close();
  }
});

test("corrected Storage fixture uses real Project DDL and retains agent-evidence regression probes", async () => {
  const db = new PGlite();
  const statements = [],
    uploads = [];
  let fileSql;
  const run = runFixture({
    query: (sql) => statements.push(sql),
    json: (sql) => {
      fileSql = sql;
      throw new Error("captured_project_fixture");
    },
  });
  run.storagePreflight = () => {};
  run.signupOwner = { principal: { accountId: owner }, cookie: "test-cookie" };
  run.signup = async () => ({ principal: { accountId: "20000000-0000-4000-8000-000000000002" } });
  run.service = async (path) => {
    uploads.push(path);
    return { status: 200 };
  };
  try {
    await assert.rejects(run.storageCheck(), /captured_project_fixture/);
    assert.equal(uploads.length, 2);
    assert.match(uploads[0], /^\/storage\/v1\/object\/agent-evidence\//);
    assert.match(uploads[1], /^\/storage\/v1\/object\/project-files\//);
    assert.ok(statements.every((sql) => !sql.includes("agent_jobs")));
    const projects = readFileSync(
      "supabase/migrations/20260712011732_d735f53a-21fb-4543-8ecb-456c04bade12.sql",
      "utf8",
    ).match(/CREATE TABLE public.projects \([\s\S]*?\n\);/)[0];
    const files = readFileSync(
      "supabase/migrations/20260713010018_ae3321a8-3e87-46f9-9e37-867848dd48b6.sql",
      "utf8",
    ).match(/CREATE TABLE IF NOT EXISTS public.project_files \([\s\S]*?\n\);/)[0];
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); ${projects} ${files}
      alter table public.project_files add column status text not null default 'ready', add column content_sha256 text;
      insert into auth.users values('${owner}');`);
    for (const sql of statements) await db.exec(sql);
    const row = (await db.query(fileSql)).rows[0].row_to_json;
    const { ownedPrivateFileLink } = await import("../../src/lib/kova-auth-private-download.mjs");
    const link = await ownedPrivateFileLink("project", owner, row);
    assert.equal(new URL(link, ORIGIN).searchParams.get("kind"), "project");
    assert.equal(row.size_bytes, 68);
  } finally {
    await run.dispatcher.close();
    await db.close();
  }
});

test("Realtime timeouts identify the exact phase and retain safe transport counters", async () => {
  const { waitForRealtime } = await import("../../scripts/release/s6-realtime-probe.mjs");
  const run = runFixture();
  let now = 0;
  try {
    await run.check("realtime_reauthorization", () =>
      waitForRealtime(
        run,
        "realtime_initial_owner_event",
        () => false,
        { subscribed: 1, messages: 0, socketErrors: 0, secret: "must-not-leak" },
        200,
        () => now,
        async () => {
          now += 100;
        },
      ),
    );
    const row = run.records[0];
    assert.equal(row.assertionId, "realtime_initial_owner_event");
    assert.equal(row.actual, false);
    assert.equal(row.expected, true);
    assert.deepEqual(row.diagnostics, { subscribed: 1, messages: 0, socketErrors: 0 });
    assert.ok(!JSON.stringify(row).includes("must-not-leak"));
  } finally {
    await run.dispatcher.close();
  }
});

test("Storage preflight fails before creating identities or objects for missing setup", async () => {
  const run = runFixture({ json: () => ({ bucket: false, columns: 0 }) });
  run.signup = () => assert.fail("must not create identity before preflight");
  try {
    await assert.rejects(run.storageCheck(), /storage_private_project_bucket/);
  } finally {
    await run.dispatcher.close();
  }
});

test("project cleanup tolerates absent optional provenance and preserves unrelated projects", async () => {
  for (const provenance of [false, true]) {
    const db = new PGlite();
    const run = runFixture();
    const id = "30000000-0000-4000-8000-000000000003";
    const statements = [];
    run.fixtures = [
      { email: `s6-${run.runId}-signup@example.invalid`, principal: { accountId: owner } },
    ];
    run.projects = [{ id, owner }];
    run.db = {
      query: (sql) => {
        statements.push(sql);
      },
      json: () => ({ credentials: 0, sessions: 0, activeAccounts: 0, queued: 0 }),
    };
    try {
      await run.cleanup();
      const sql = statements.find((x) => x.includes("delete from public.projects"));
      await db.exec(`create table public.projects(id uuid,owner_id uuid,name text);
        insert into public.projects values('${id}','${owner}','S6 ${run.runId}'),(gen_random_uuid(),'${owner}','unrelated');`);
      if (provenance)
        await db.exec(
          "create table public.project_storage_source_provenance(project_id uuid,owner_id uuid,storage_path text)",
        );
      await db.exec(sql);
      assert.deepEqual((await db.query("select name from public.projects")).rows, [
        { name: "unrelated" },
      ]);
    } finally {
      await run.dispatcher.close();
      await db.close();
    }
  }
});
