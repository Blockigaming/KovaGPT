import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { execFileSync } from "node:child_process";
import {
  WORK_RUNTIME_MIGRATION,
  WORK_RUNTIME_TABLES,
  WORK_RUNTIME_FUNCTIONS,
  WORK_RUNTIME_CANONICAL_COLUMN_ACL_CHECK,
  workRuntimePreflight,
  workRuntimeInstallationSnapshot,
  captureUnusedWorkRuntimeQualification,
  unusedWorkRuntimeRollback,
} from "../../scripts/release/work-runtime-forward-guards.mjs";

const catalog = JSON.parse(
  await readFile("tests/fixtures/work-runtime-prerequisite-catalog-20261030.json", "utf8"),
);
const migration = await readFile(WORK_RUNTIME_MIGRATION, "utf8");
const USER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  SESSION = "33333333-3333-4333-8333-333333333333";
const ident = (s) => '"' + s.replaceAll('"', '""') + '"';
async function fixture({ install = true, before } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth; create schema kova_private;create schema kova_auth_guard;
   revoke all on schema kova_private from public,anon,authenticated;
   grant usage on schema kova_private to service_role;
   grant usage on schema auth,kova_auth_guard to service_role,anon,authenticated;
   create type public.project_role as enum('owner','editor','viewer');
   create table auth.users(id uuid primary key,deleted_at timestamptz);
   insert into auth.users(id) values('${USER}'),('${OTHER}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table kova_private.auth_legacy_retirements(account_id uuid primary key);
   create table kova_private.auth_accounts(id uuid primary key,session_epoch bigint,primary_email text,email_verified_at timestamptz,deleted_at timestamptz,legacy_supabase_user_id uuid,suspended_until timestamptz,mfa_required boolean);
   create table kova_private.auth_sessions(id uuid primary key,account_id uuid,session_epoch bigint,revoked_at timestamptz,created_at timestamptz,expires_at timestamptz,assurance_level text);
   create function kova_private.legacy_principal_permitted(uuid) returns boolean language sql as $$select true$$;
   create function kova_private.legacy_mfa_required(uuid) returns boolean language sql as $$select false$$;`);
    for (const t of catalog.baseline.tables) {
      const cols = t.columns.map(
        (c) =>
          `${ident(c.name)} ${c.type}${c.not_null ? " not null" : ""}${c.default ? " default " + c.default : ""}`,
      );
      if (t.primary_key) cols.push(`primary key(${t.primary_key.map(ident).join(",")})`);
      await db.exec(
        `create table public.${ident(t.name)}(${cols.join(",")});alter table public.${ident(t.name)} enable row level security;revoke all on public.${ident(t.name)} from public,anon,authenticated,service_role;`,
      );
      for (const a of t.acl)
        await db.exec(
          `grant ${a.privilege} on table public.${ident(t.name)} to ${a.grantee === "PUBLIC" ? "public" : ident(a.grantee)}${a.grantable ? " with grant option" : ""};`,
        );
    }
    for (const f of catalog.baseline.functions) {
      await db.exec(f.definition);
      const sig = f.name === "auth_user_exists" ? "uuid" : "uuid,uuid,text";
      await db.exec(
        `revoke all on function ${f.schema}.${f.name}(${sig}) from public,anon,authenticated;grant execute on function ${f.schema}.${f.name}(${sig}) to service_role;`,
      );
    }
    await db.exec(catalog.sessionGuard.definition);
    await db.exec(
      `revoke all on function kova_auth_guard.session_is_active() from public;grant execute on function kova_auth_guard.session_is_active() to anon,authenticated,service_role;`,
    );
    if (before) await before(db);
    if (install) await db.exec(migration);
    return db;
  } catch (e) {
    await db.close();
    throw Error(`${e.code ?? ""}: ${e.message}${e.where ? " " + e.where : ""}`);
  }
}
const query = (db) => (sql, args) => db.query(sql, args);
const rows = (db, sql, args) => db.query(sql, args).then((x) => x.rows);
async function failure(db, sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
  await db.exec("rollback;reset role");
}
async function claims(db, { owner = USER, owned = false, session = SESSION } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = owned
    ? {
        sub: owner,
        role: "authenticated",
        aud: "authenticated",
        email_verified: true,
        email: "owner@example.invalid",
        aal: "aal1",
        session_id: session,
        kova_auth: 1,
        iat: now,
        exp: now + 240,
      }
    : { sub: owner, role: "authenticated" };
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [owner, JSON.stringify(payload)],
  );
  await db.exec("set role authenticated");
}

test("the actual native fixture bootstraps all captured helper definitions in one SQL batch", async () => {
  const nativeSql = await readFile(
    "tests/fixtures/work-runtime-forward-native-smoke-20261030.sql",
    "utf8",
  );
  const start = nativeSql.indexOf("create schema auth;");
  const end = nativeSql.indexOf("begin read only;");
  assert.ok(start > 0 && end > start);
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;" +
        nativeSql.slice(start, end),
    );
    await db.exec("begin read only;" + (await workRuntimePreflight()) + ";rollback");
    assert.equal(
      (await rows(db, "select to_regclass('public.work_execution_runs') as t"))[0].t,
      null,
    );
  } finally {
    await db.close();
  }
});

test("all exact native canonical replays preserve rows, Library column grants and read-only no-ops", async () => {
  const cases = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import importlib.util,json,pathlib;s=importlib.util.spec_from_file_location('native','scripts/release/work-runtime-forward-native.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);r=pathlib.Path.cwd();print(json.dumps(m.canonical_smoke_sources(r,m.validate_sources(r))))",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  );
  assert.equal(Object.keys(cases).length, 6);
  for (const [marker, sql] of Object.entries(cases)) {
    assert.equal(sql.split(migration).length, 2);
    const db = new PGlite();
    try {
      await db.exec(
        "create role anon;create role authenticated;create role service_role bypassrls;",
      );
      const results = await db.exec(sql.replace(/^\\set ON_ERROR_STOP on\n/m, ""));
      assert.equal(results.at(-1).rows[0].evidence, marker);
      assert.equal(
        (await rows(db, "select count(*)::int n from public.work_sync_counters"))[0].n,
        1,
      );
      assert.equal(
        (await rows(db, "select current_setting('default_transaction_read_only') as value"))[0]
          .value,
        "off",
      );
    } finally {
      await db.close();
    }
  }
});
test("frozen production prerequisite metadata passes read-only preflight before any Work installation", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec("begin read only;" + (await workRuntimePreflight()) + ";rollback");
    assert.equal(
      (await rows(db, "select to_regclass('public.work_execution_runs') as t"))[0].t,
      null,
    );
  } finally {
    await db.close();
  }
});
test("forward installation pins prerequisites and creates ten guarded tables and 22 server-only functions", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (
        await rows(
          db,
          "select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1)",
          [WORK_RUNTIME_TABLES],
        )
      )[0].n,
      10,
    );
    const fs = await rows(
      db,
      "select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') a,has_function_privilege('authenticated',p.oid,'EXECUTE') u,has_function_privilege('service_role',p.oid,'EXECUTE') s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1)",
      [WORK_RUNTIME_FUNCTIONS],
    );
    assert.equal(fs.length, 22);
    assert.ok(fs.every((x) => !x.a && !x.u && x.s && !x.prosecdef));
    const ts = await rows(
      db,
      "select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') a,has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') u,has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1)",
      [WORK_RUNTIME_TABLES],
    );
    assert.ok(
      ts.every(
        (x) =>
          x.relrowsecurity &&
          !x.a &&
          !x.u &&
          (x.s || ["work_execution_outputs", "work_accounting_settlements"].includes(x.relname)),
      ),
    );
    for (const [table, forbidden] of [
      ["work_execution_outputs", "UPDATE"],
      ["work_accounting_settlements", "UPDATE,DELETE"],
    ])
      assert.equal(
        (
          await rows(db, "select has_table_privilege('service_role',$1,$2) as permitted", [
            "public." + table,
            forbidden,
          ])
        )[0].permitted,
        false,
      );
    const policies = await rows(
      db,
      "select count(*)::int n from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname=any($1) and p.polname='kova_owned_session_guard' and not p.polpermissive and p.polcmd='*'",
      [WORK_RUNTIME_TABLES],
    );
    assert.equal(policies[0].n, 10);
  } finally {
    await db.close();
  }
});

async function canonicalFixture({ defaults = "" } = {}) {
  const db = await fixture({ install: false });
  if (defaults) await db.exec(defaults);
  for (const entry of catalog.canonicalSources) await db.exec(await readFile(entry.path, "utf8"));
  for (const name of WORK_RUNTIME_TABLES)
    await db.exec(
      `create policy kova_owned_session_guard on public.${name} as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()))`,
    );
  return db;
}

test("complete canonical history takes only the exact no-op branch and preserves installed rows", async () => {
  const db = await canonicalFixture();
  try {
    await db.exec(`insert into public.work_sync_counters(owner_id) values('${USER}');`);
    const before = await workRuntimeInstallationSnapshot(query(db));
    await db.exec(migration);
    assert.deepEqual(await workRuntimeInstallationSnapshot(query(db)), before);
    assert.equal((await rows(db, "select count(*)::int n from public.work_sync_counters"))[0].n, 1);
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(query(db)),
      /work_forward_incomplete_installation/,
    );
  } finally {
    await db.close();
  }
});

const cliRevokeCrudDefaults =
  "alter default privileges in schema public grant all on tables to service_role;" +
  "alter default privileges for role postgres in schema public revoke select,insert,update,delete on tables from anon,authenticated,service_role;";

test("the published CLI default-CRUD revocation retains the exact service-role catalog read-only", async () => {
  const db = await canonicalFixture({ defaults: cliRevokeCrudDefaults });
  try {
    await db.exec(`insert into public.work_sync_counters(owner_id) values('${USER}')`);
    const before = await workRuntimeInstallationSnapshot(query(db));
    const checks = await rows(
      db,
      "select has_table_privilege('service_role','public.work_execution_outputs','UPDATE') as output_update,has_table_privilege('service_role','public.work_accounting_settlements','DELETE') as settlement_delete,has_table_privilege('service_role','public.work_execution_outputs','TRUNCATE') as retained_truncate,has_table_privilege('service_role','public.work_accounting_settlements','MAINTAIN') as retained_maintain",
    );
    assert.deepEqual(checks[0], {
      output_update: false,
      settlement_delete: false,
      retained_truncate: true,
      retained_maintain: true,
    });
    await db.exec("set default_transaction_read_only=on");
    await db.exec(migration);
    assert.deepEqual(await workRuntimeInstallationSnapshot(query(db)), before);
    assert.equal((await rows(db, "select count(*)::int n from public.work_sync_counters"))[0].n, 1);
    await db.exec("set default_transaction_read_only=off");
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(query(db)),
      /work_forward_incomplete_installation/,
    );
  } finally {
    await db.close();
  }
});

test("extra or removed service grants, browser grants, comments and overloads fail the full CLI catalog", async () => {
  for (const change of [
    "grant update on public.work_execution_outputs to service_role",
    "grant delete on public.work_accounting_settlements to service_role",
    "revoke maintain on public.work_execution_runs from service_role",
    "revoke select on public.work_execution_outputs from service_role",
    "grant select on public.work_execution_runs to anon",
    "grant insert on public.work_execution_runs to authenticated",
    "comment on table public.work_execution_runs is 'unexpected catalog drift'",
    "create function public.next_work_sync_version(uuid,text) returns bigint language sql as $$select 1::bigint$$",
  ]) {
    const db = await canonicalFixture({ defaults: cliRevokeCrudDefaults });
    try {
      await db.exec(change);
      const changed = await workRuntimeInstallationSnapshot(query(db));
      await failure(db, migration, /work_forward_existing_object/);
      assert.deepEqual(await workRuntimeInstallationSnapshot(query(db)), changed);
    } finally {
      await db.close();
    }
  }
});

test("prerequisite column, default, grant and helper drift each block before writes", async () => {
  for (const sql of [
    "alter table public.projects add column unexpected text",
    "alter table public.projects alter column color set default 'unexpected'",
    "grant select on public.account_deletion_fences to anon",
    "create or replace function kova_private.auth_user_exists(p_user_id uuid) returns boolean language sql as $$select true$$",
  ]) {
    const db = await fixture({ install: false });
    try {
      await db.exec(sql);
      await failure(db, migration, /work_forward_baseline_drift/);
      assert.equal(
        (await rows(db, "select to_regclass('public.work_execution_runs') t"))[0].t,
        null,
      );
    } finally {
      await db.close();
    }
  }
});
test("a partial or altered canonical Work installation is never silently overwritten", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec("create table public.work_saved_records(id uuid)");
    await failure(db, migration, /work_forward_existing_object/);
  } finally {
    await db.close();
  }
  const canonical = await canonicalFixture();
  try {
    await canonical.exec("grant select on public.work_execution_receipts to authenticated");
    await failure(canonical, migration, /work_forward_existing_object/);
  } finally {
    await canonical.close();
  }
});
test("a changed session revocation guard blocks before creating the Work contract", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec(
      "create or replace function kova_auth_guard.session_is_active() returns boolean language plpgsql stable security definer set search_path='' as $$begin return true;end$$",
    );
    await failure(db, migration, /work_forward_session_guard_drift/);
  } finally {
    await db.close();
  }
});
test("synthetic prerequisite rows and helper definitions remain identical after installation", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec(
      `insert into public.projects(id,owner_id,name) values('${SESSION}','${USER}','Retain original UUID');`,
    );
    const old = await rows(db, "select row_to_json(p) as value from public.projects p order by id");
    const f = await rows(
      db,
      "select pg_get_functiondef('kova_private.auth_user_exists(uuid)'::regprocedure) definition",
    );
    await db.exec(migration);
    assert.deepEqual(
      await rows(db, "select row_to_json(p) as value from public.projects p order by id"),
      old,
    );
    assert.deepEqual(
      await rows(
        db,
        "select pg_get_functiondef('kova_private.auth_user_exists(uuid)'::regprocedure) definition",
      ),
      f,
    );
  } finally {
    await db.close();
  }
});
async function insertSaved(db) {
  await db.exec(`insert into public.work_sync_counters(owner_id) values('${USER}'),('${OTHER}');
 insert into public.work_saved_records(owner_id,id,kind,title,payload,sync_version) values
 ('${USER}','${USER}','task','Owner private','{}',1),('${OTHER}','${OTHER}','task','Other private','{}',1);`);
}
test("hosted principals read only their own Work rows and cannot forge writes", async () => {
  const db = await fixture();
  try {
    await insertSaved(db);
    await claims(db);
    assert.deepEqual(
      (await rows(db, "select owner_id from public.work_saved_records")).map((x) => x.owner_id),
      [USER],
    );
    await assert.rejects(
      db.exec(
        `insert into public.work_saved_records(owner_id,id,kind,title,payload,sync_version) values('${USER}','${SESSION}','task','Forged','{}',2)`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("select public.next_work_sync_version('11111111-1111-4111-8111-111111111111')"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("the real owned-session predicate permits a current session then denies the revoked session", async () => {
  const db = await fixture();
  try {
    await insertSaved(db);
    await db.exec(`insert into kova_private.auth_accounts(id,session_epoch,primary_email,email_verified_at,mfa_required) values('${USER}',1,'owner@example.invalid',now(),false);
   insert into kova_private.auth_sessions values('${SESSION}','${USER}',1,null,now()-interval '1 second',now()+interval '5 minutes','aal1');`);
    await claims(db, { owned: true });
    assert.equal((await rows(db, "select count(*)::int n from public.work_saved_records"))[0].n, 1);
    await db.exec(
      `reset role;update kova_private.auth_sessions set revoked_at=now() where id='${SESSION}'`,
    );
    await claims(db, { owned: true });
    assert.equal((await rows(db, "select count(*)::int n from public.work_saved_records"))[0].n, 0);
  } finally {
    await db.close();
  }
});
test("retired hosted authority and malformed owned claims cannot retain Work reads", async () => {
  const db = await fixture();
  try {
    await insertSaved(db);
    await db.exec(`insert into kova_private.auth_legacy_retirements values('${USER}')`);
    await claims(db);
    assert.equal((await rows(db, "select count(*)::int n from public.work_saved_records"))[0].n, 0);
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [USER, JSON.stringify({ sub: USER, role: "authenticated", kova_auth: 1, exp: 0 })],
    );
    await db.exec("set role authenticated");
    assert.equal((await rows(db, "select count(*)::int n from public.work_saved_records"))[0].n, 0);
  } finally {
    await db.close();
  }
});
test("saved mutation identity is durable, reused content rejects and deletion scrubs the body", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const sql =
      "select public.upsert_work_saved_record($1,$2,$3,'task','Synthetic task',$4,0) value";
    const args = [USER, SESSION, USER, { objective: "Private synthetic objective" }];
    const first = (await rows(db, sql, args))[0].value;
    assert.deepEqual((await rows(db, sql, args))[0].value, first);
    await assert.rejects(
      db.query(sql, [USER, SESSION, USER, { objective: "Changed objective" }]),
      /work_sync_mutation_reused/,
    );
    await db.query("select public.delete_work_saved_record($1,$2,$3,1)", [USER, OTHER, USER]);
    const record = (
      await rows(
        db,
        "select title,payload,deleted_at from public.work_saved_records where owner_id=$1",
        [USER],
      )
    )[0];
    assert.equal(record.title, "Deleted Work item");
    assert.deepEqual(record.payload, {});
    assert.ok(record.deleted_at);
  } finally {
    await db.close();
  }
});
const RUN = "44444444-4444-4444-8444-444444444444";
function state(revision = 1) {
  return {
    protocol: "kova-work-v1",
    id: RUN,
    ownerId: USER,
    requestHash: "a".repeat(64),
    revision,
    status: "queued",
    plan: "plus",
    request: { mutationId: SESSION, sessionId: null, sessionRevision: null, projectId: null },
    sessionContext: null,
    event: { kind: "queued", detail: {} },
  };
}
const commit = (
  db,
  input,
  {
    mutation = SESSION,
    expected = 0,
    hash = "b".repeat(64),
    ready = new Date(Date.now() + 30000).toISOString(),
  } = {},
) =>
  db.query("select public.commit_work_execution($1,$2,$3,$4,$5,$6,$7,1) value", [
    USER,
    RUN,
    mutation,
    hash,
    expected,
    input,
    ready,
  ]);
test("execution CAS converges original admission, rejects stale revisions and immutable input changes", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const first = (await commit(db, state())).rows[0].value;
    assert.equal(first.idempotent, false);
    assert.equal((await commit(db, state())).rows[0].value.idempotent, true);
    await assert.rejects(
      commit(db, state(2), { mutation: OTHER, expected: 0 }),
      /work_revision_invalid/,
    );
    await assert.rejects(
      commit(db, { ...state(2), plan: "pro" }, { mutation: OTHER, expected: 1 }),
      /work_immutable_input_changed/,
    );
    assert.equal(
      (await commit(db, state(2), { mutation: OTHER, expected: 1 })).rows[0].value.appliedRevision,
      2,
    );
    await assert.rejects(
      commit(db, state(2), { mutation: RUN, expected: 1 }),
      /work_revision_conflict/,
    );
  } finally {
    await db.close();
  }
});
test("deletion fence and stale signed runner readiness prevent new admitted Work rows", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `insert into public.account_deletion_fences(user_id) values('${USER}');set role service_role`,
    );
    await assert.rejects(commit(db, state()), /work_account_unavailable/);
    await db.exec(`reset role;delete from public.account_deletion_fences;set role service_role`);
    await assert.rejects(
      commit(db, state(), { ready: new Date(Date.now() - 10000).toISOString() }),
      /work_admission_unavailable/,
    );
    assert.equal(
      (await rows(db, "select count(*)::int n from public.work_execution_runs"))[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("unused qualification removes only this installation and preserves prerequisite data", async () => {
  const db = await fixture();
  try {
    const before = await rows(db, "select id from auth.users order by id");
    const qualification = await captureUnusedWorkRuntimeQualification(query(db));
    await db.exec(await unusedWorkRuntimeRollback(qualification));
    assert.equal(
      (await rows(db, "select to_regclass('public.work_execution_runs') value"))[0].value,
      null,
    );
    assert.deepEqual(await rows(db, "select id from auth.users order by id"), before);
    await db.exec("begin read only;" + (await workRuntimePreflight()) + ";rollback");
  } finally {
    await db.close();
  }
});
test("any used Work state blocks qualification and previously qualified uninstall", async () => {
  const db = await fixture();
  try {
    const qualification = await captureUnusedWorkRuntimeQualification(query(db));
    await db.exec(`insert into public.work_sync_counters(owner_id) values('${USER}')`);
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(query(db)),
      /work_forward_used_schema_keep_on_rollback/,
    );
    await failure(
      db,
      await unusedWorkRuntimeRollback(qualification),
      /work_forward_used_schema_keep_on_rollback/,
    );
    assert.equal((await rows(db, "select count(*)::int n from public.work_sync_counters"))[0].n, 1);
  } finally {
    await db.close();
  }
});
test("changed definitions, grants or an unknown dependant never get cascaded away", async () => {
  const db = await fixture();
  try {
    const qualification = await captureUnusedWorkRuntimeQualification(query(db));
    await db.exec("grant select on public.work_sync_mutations to anon");
    await failure(
      db,
      await unusedWorkRuntimeRollback(qualification),
      /work_forward_installation_drift/,
    );
    await db.exec("revoke select on public.work_sync_mutations from anon");
    const restored = await captureUnusedWorkRuntimeQualification(query(db));
    await db.exec(
      "create view public.synthetic_work_dependant as select owner_id from public.work_sync_counters",
    );
    await failure(db, await unusedWorkRuntimeRollback(restored), /depend on (?:it|them)/);
    assert.ok((await rows(db, "select to_regclass('public.work_execution_runs') value"))[0].value);
  } finally {
    await db.close();
  }
});

test("all reconstructed routine bodies and table contracts match the canonical final source", async () => {
  const installed = await fixture(),
    canonical = await canonicalFixture();
  try {
    const actual = await workRuntimeInstallationSnapshot(query(installed));
    const previous = await workRuntimeInstallationSnapshot(query(canonical));
    assert.deepEqual(actual.functions, previous.functions);
    const sync = new Set([
      "work_sync_counters",
      "work_saved_records",
      "work_recent_items",
      "work_sync_mutations",
    ]);
    const shape = (t) => ({
      ...t,
      comment: null,
      acl: t.acl.filter(
        (a) =>
          !(
            sync.has(t.name) &&
            a.grantee === "service_role" &&
            ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"].includes(a.privilege)
          ),
      ),
    });
    assert.deepEqual(actual.tables.map(shape), previous.tables.map(shape));
  } finally {
    await installed.close();
    await canonical.close();
  }
});

test("a caller-forged canonical qualification cannot uninstall a schema this forward did not create", async () => {
  const installed = await fixture(),
    canonicalDb = await canonicalFixture();
  try {
    const q = await captureUnusedWorkRuntimeQualification(query(installed));
    q.snapshot = await workRuntimeInstallationSnapshot(query(canonicalDb));
    const { createHash } = await import("node:crypto");
    q.snapshotSha256 = createHash("sha256").update(JSON.stringify(q.snapshot)).digest("hex");
    await assert.rejects(unusedWorkRuntimeRollback(q), /work_forward_invalid_qualification/);
    assert.ok(
      (await rows(canonicalDb, "select to_regclass('public.work_execution_runs') value"))[0].value,
    );
  } finally {
    await installed.close();
    await canonicalDb.close();
  }
});
test("marked but modified installations cannot acquire a new unused qualification", async () => {
  const db = await fixture();
  try {
    await db.exec("alter function public.next_work_sync_version(uuid) set statement_timeout='1s'");
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(query(db)),
      /work_forward_installation_drift/,
    );
  } finally {
    await db.close();
  }
});
test("canonical no-op qualification rejects dangerous browser role drift", async () => {
  const db = await canonicalFixture();
  try {
    await db.exec("alter role authenticated bypassrls");
    await failure(db, migration, /work_forward_role_drift/);
  } finally {
    await db.close();
  }
});

const canonicalLibraryColumnGrants =
  "REVOKE UPDATE ON public.user_library_items FROM authenticated;\nGRANT UPDATE(title,folder_id,updated_at) ON public.user_library_items TO authenticated;";
const explicitColumnAclSnapshot =
  "select c.relname,a.attname,a.attacl::text as acl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0 order by c.relname,a.attnum";

test("the canonical Library profile is the exact published grant and remains a read-only no-op", async () => {
  const published = await readFile(
    "supabase/migrations/20260905031000_library_content_versions.sql",
    "utf8",
  );
  assert.equal(published.split(canonicalLibraryColumnGrants).length, 2);
  const embedded = migration
    .split(" -- WORK_CANONICAL_COLUMN_ACL_BEGIN\n")[1]
    .split("\n -- WORK_CANONICAL_COLUMN_ACL_END")[0];
  assert.equal(
    embedded,
    " if not (" +
      WORK_RUNTIME_CANONICAL_COLUMN_ACL_CHECK.replace(/ as valid$/, "") +
      ") then raise exception 'work_forward_column_acl_drift'; end if;",
  );
  const db = await canonicalFixture();
  try {
    await db.exec(canonicalLibraryColumnGrants);
    await db.exec(`insert into public.work_sync_counters(owner_id) values('${USER}')`);
    const beforeColumns = await rows(db, explicitColumnAclSnapshot);
    const beforeWork = await workRuntimeInstallationSnapshot(query(db));
    assert.equal(beforeColumns.length, 3);
    assert.equal((await rows(db, WORK_RUNTIME_CANONICAL_COLUMN_ACL_CHECK))[0].valid, true);
    await db.exec("set default_transaction_read_only=on");
    await db.exec(migration);
    await db.exec("reset default_transaction_read_only");
    assert.deepEqual(await rows(db, explicitColumnAclSnapshot), beforeColumns);
    assert.deepEqual(await workRuntimeInstallationSnapshot(query(db)), beforeWork);
    assert.equal((await rows(db, "select count(*)::int n from public.work_sync_counters"))[0].n, 1);
  } finally {
    await db.close();
  }
});

test("partial, additional, grantable, other-recipient and weakened canonical Library profiles fail", async () => {
  for (const change of [
    "revoke update(title) on public.user_library_items from authenticated",
    "grant select(title) on public.user_library_items to authenticated",
    "grant update(title) on public.user_library_items to authenticated with grant option",
    "grant update(title) on public.user_library_items to anon",
    "grant update(totals) on public.work_accounting_settlements to service_role",
    "grant update on public.user_library_items to authenticated",
    "alter table public.user_library_items disable row level security",
    "alter table public.user_library_items force row level security",
    "alter table public.user_library_items owner to service_role",
  ]) {
    const db = await canonicalFixture();
    try {
      await db.exec(canonicalLibraryColumnGrants);
      await db.exec(change);
      const beforeColumns = await rows(db, explicitColumnAclSnapshot);
      const beforeWork = await workRuntimeInstallationSnapshot(query(db));
      assert.equal((await rows(db, WORK_RUNTIME_CANONICAL_COLUMN_ACL_CHECK))[0].valid, false);
      await failure(db, migration, /work_forward_column_acl_drift/);
      assert.deepEqual(await rows(db, explicitColumnAclSnapshot), beforeColumns);
      assert.deepEqual(await workRuntimeInstallationSnapshot(query(db)), beforeWork);
    } finally {
      await db.close();
    }
  }
});

test("the Library canonical exception never relaxes the legacy install or captured rollback profile", async () => {
  const absent = await fixture({ install: false });
  const installed = await fixture();
  try {
    const q = await captureUnusedWorkRuntimeQualification(query(installed));
    for (const db of [absent, installed]) await db.exec(canonicalLibraryColumnGrants);
    await failure(absent, migration, /work_forward_column_acl_drift/);
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(query(installed)),
      /work_forward_column_acl_drift/,
    );
    await failure(installed, await unusedWorkRuntimeRollback(q), /work_forward_column_acl_drift/);
    assert.equal(
      (await rows(absent, "select to_regclass('public.work_execution_runs') t"))[0].t,
      null,
    );
    assert.equal((await rows(installed, explicitColumnAclSnapshot)).length, 3);
  } finally {
    await absent.close();
    await installed.close();
  }
});

test("column grants cannot evade canonical, captured or uninstall privilege qualification", async () => {
  const installed = await fixture(),
    canonicalDb = await canonicalFixture();
  try {
    const q = await captureUnusedWorkRuntimeQualification(query(installed));
    for (const db of [installed, canonicalDb])
      await db.exec("grant update(totals) on public.work_accounting_settlements to service_role");
    assert.equal(
      (
        await rows(
          installed,
          "select has_table_privilege('service_role','public.work_accounting_settlements','UPDATE') t,has_column_privilege('service_role','public.work_accounting_settlements','totals','UPDATE') c",
        )
      )[0].t,
      false,
    );
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(query(installed)),
      /work_forward_column_acl_drift/,
    );
    await failure(installed, await unusedWorkRuntimeRollback(q), /work_forward_column_acl_drift/);
    await failure(canonicalDb, migration, /work_forward_column_acl_drift/);
  } finally {
    await installed.close();
    await canonicalDb.close();
  }
});
test("prerequisite column privileges and broader new-object default grants reject atomically", async () => {
  for (const change of [
    "grant select(name) on public.projects to anon",
    "create role synthetic_consumer;alter default privileges in schema public grant select on tables to synthetic_consumer",
    "create role synthetic_consumer;alter default privileges in schema public grant execute on functions to synthetic_consumer",
  ]) {
    const db = await fixture({ install: false });
    try {
      await db.exec(change);
      await failure(db, migration, /work_forward_(?:column_acl|installation)_drift/);
      assert.equal(
        (await rows(db, "select to_regclass('public.work_execution_runs') t"))[0].t,
        null,
      );
    } finally {
      await db.close();
    }
  }
});

test("production-style postgres public table defaults converge to exact new Work grants", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec(
      "alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated",
    );
    await db.exec(migration);
    await captureUnusedWorkRuntimeQualification(query(db));
    assert.equal(
      (
        await rows(
          db,
          "select has_table_privilege('service_role','public.work_accounting_settlements','UPDATE,DELETE') value",
        )
      )[0].value,
      false,
    );
  } finally {
    await db.close();
  }
});

test("the exact historical Supabase default-ACL canonical profile is a preserving no-op", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec(
      "alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated",
    );
    for (const entry of catalog.canonicalSources) await db.exec(await readFile(entry.path, "utf8"));
    for (const name of WORK_RUNTIME_TABLES)
      await db.exec(
        `create policy kova_owned_session_guard on public.${name} as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()))`,
      );
    const before = await workRuntimeInstallationSnapshot(query(db));
    await db.exec(migration);
    assert.deepEqual(await workRuntimeInstallationSnapshot(query(db)), before);
    await db.exec("revoke update on public.work_accounting_settlements from service_role");
    await failure(db, migration, /work_forward_existing_object/);
  } finally {
    await db.close();
  }
});

test("unused qualifications bind the actual immutable PostgreSQL major", async () => {
  const db = await fixture();
  try {
    const qualification = await captureUnusedWorkRuntimeQualification(query(db));
    const major = (
      await rows(db, "select current_setting('server_version_num')::integer / 10000 as major")
    )[0].major;
    assert.equal(qualification.schemaVersion, 2);
    assert.equal(qualification.serverMajor, major);
    const rollback = await unusedWorkRuntimeRollback(qualification);
    assert.match(rollback, new RegExp("server_version_num'\\)::integer / 10000<>" + major));
    await assert.rejects(db.exec("set server_version_num='170006'"), /cannot be changed/);
    await assert.rejects(
      unusedWorkRuntimeRollback({ ...qualification, serverMajor: major === 18 ? 17 : 18 }),
      /work_forward_invalid_qualification/,
    );
    await db.exec(rollback);
    assert.equal(
      (await rows(db, "select to_regclass('public.work_execution_runs') as value"))[0].value,
      null,
    );
  } finally {
    await db.close();
  }
});

test("unsupported or falsely reported server majors cannot acquire an unused qualification", async () => {
  const db = await fixture();
  try {
    const actualMajor = (
      await rows(db, "select current_setting('server_version_num')::integer / 10000 as major")
    )[0].major;
    for (const major of [16, 19, null, "18", "toString", 17.5]) {
      let otherQueries = 0;
      const adapter = async (sql, args) => {
        if (sql.includes("server_version_num")) return { rows: [{ major }] };
        otherQueries++;
        return db.query(sql, args);
      };
      await assert.rejects(
        captureUnusedWorkRuntimeQualification(adapter),
        /work_forward_server_version_unsupported/,
      );
      assert.equal(otherQueries, 0);
    }
    const adapter = (sql, args) =>
      sql.includes("server_version_num")
        ? Promise.resolve({ rows: [{ major: actualMajor === 18 ? 17 : 18 }] })
        : db.query(sql, args);
    await assert.rejects(
      captureUnusedWorkRuntimeQualification(adapter),
      /work_forward_installation_drift/,
    );
  } finally {
    await db.close();
  }
});

test("NOT NULL column drift and PostgreSQL18 constraint renaming retain full fingerprint protection", async () => {
  for (const change of ["column", "constraint"]) {
    const db = await fixture();
    try {
      if (change === "column") {
        await db.exec("alter table public.work_execution_runs alter column owner_id drop not null");
      } else {
        const major = (
          await rows(db, "select current_setting('server_version_num')::integer / 10000 as major")
        )[0].major;
        assert.equal(major, 18);
        const name = (
          await rows(
            db,
            "select c.conname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.conrelid='public.work_execution_runs'::regclass and c.contype='n' and a.attname='owner_id'",
          )
        )[0].conname;
        await db.exec(
          `alter table public.work_execution_runs rename constraint ${ident(name)} to changed_not_null_constraint`,
        );
      }
      await assert.rejects(
        captureUnusedWorkRuntimeQualification(query(db)),
        /work_forward_installation_drift/,
      );
    } finally {
      await db.close();
    }
  }
});
