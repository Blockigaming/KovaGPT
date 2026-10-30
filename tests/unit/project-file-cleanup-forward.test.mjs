import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const path = "supabase/migrations/20261030121047_kova_project_file_cleanup_definitions_forward.sql";
const migration = await readFile(path, "utf8");
const original = await readFile(
  "supabase/migrations/20260904200000_project_file_upload_integrity.sql",
  "utf8",
);
const account = await readFile(
  "supabase/migrations/20260904231310_account_project_file_lifecycle.sql",
  "utf8",
);
const canonical = original.slice(
  original.indexOf("CREATE OR REPLACE FUNCTION public.claim_stale_project_file_cleanup("),
  original.indexOf("CREATE OR REPLACE FUNCTION public.claim_project_file_delete("),
);
const names = [
  "claim_stale_project_file_cleanup",
  "renew_stale_project_file_cleanup",
  "fail_stale_project_file_cleanup",
  "finalize_stale_project_file_cleanup",
];
const signatures = [
  "public.claim_stale_project_file_cleanup(uuid,uuid,uuid)",
  "public.renew_stale_project_file_cleanup(uuid,uuid)",
  "public.fail_stale_project_file_cleanup(uuid,uuid)",
  "public.finalize_stale_project_file_cleanup(uuid,uuid,boolean)",
];
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PROJECT = "00000000-0000-4000-8000-000000000003";
const ATTEMPT = "00000000-0000-4000-8000-000000000004";
const WRONG = "00000000-0000-4000-8000-000000000005";
const FILE = "00000000-0000-4000-8000-000000000006";
const hash = (text) => createHash("sha256").update(text).digest("hex");
function helperBlock(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = source.indexOf("TO service_role;", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + "TO service_role;".length);
}
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.projects(id uuid PRIMARY KEY,owner_id uuid NOT NULL);
      CREATE TABLE public.project_members(project_id uuid REFERENCES public.projects(id),user_id uuid);
      CREATE TABLE public.project_files(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES public.projects(id),account_cleanup_user_id uuid,status text NOT NULL DEFAULT 'ready',upload_lease_until timestamptz,delete_lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),upload_attempt_id uuid,delete_attempt_id uuid,storage_path text NOT NULL DEFAULT 'fixture/source',storage_owner_id uuid,size_bytes bigint NOT NULL DEFAULT 10,storage_charged boolean NOT NULL DEFAULT true);
      CREATE TABLE public.project_file_chunks(file_id uuid REFERENCES public.project_files(id) ON DELETE CASCADE,body text);
      CREATE TABLE public.user_storage(user_id uuid PRIMARY KEY,bytes_used bigint NOT NULL DEFAULT 10,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.project_storage_retained_charges(file_id uuid PRIMARY KEY,storage_path text NOT NULL,owner_id uuid,size_bytes bigint NOT NULL);
      CREATE TABLE public.fixture_history(version text PRIMARY KEY,receipt text);
      INSERT INTO public.fixture_history VALUES ('old','preserve');
      ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_owner_policy ON public.project_files FOR SELECT TO authenticated USING (storage_owner_id = current_setting('fixture.user',true)::uuid);
    `);
    await db.exec(helperBlock(original, "lock_project_for_file_operation"));
    await db.exec(helperBlock(account, "settle_project_source_storage_charge"));
    await db.query("INSERT INTO public.projects VALUES($1,$2)", [PROJECT, OWNER]);
    await db.query("INSERT INTO public.project_members VALUES($1,$2)", [PROJECT, OWNER]);
    await db.query("INSERT INTO public.user_storage(user_id) VALUES($1)", [OWNER]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function countTargets(db) {
  return (
    await db.query(
      "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[])",
      [names],
    )
  ).rows[0].n;
}
async function targetSnapshot(db) {
  return (
    await db.query(
      "SELECT to_jsonb(p) AS catalog,pg_get_functiondef(p.oid) AS definition,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname",
      [names],
    )
  ).rows;
}
async function preservedSnapshot(db) {
  return (
    await db.query(
      `SELECT jsonb_build_object('files',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.project_files t),'storage',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM public.user_storage t),'history',(SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM public.fixture_history t),'helpers',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'source',p.prosrc,'acl',p.proacl::text,'config',p.proconfig) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('lock_project_for_file_operation','settle_project_source_storage_charge')),'policies',(SELECT jsonb_agg(to_jsonb(t) ORDER BY policyname) FROM pg_policies t WHERE schemaname='public')) AS value`,
    )
  ).rows[0].value;
}
async function addFile(db, { status = "pending", active = false, accountCleanup = false } = {}) {
  await db.query(
    "INSERT INTO public.project_files(id,project_id,storage_owner_id,status,upload_lease_until,delete_lease_until,account_cleanup_user_id) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now()+interval '1 hour' ELSE now()-interval '1 hour' END,CASE WHEN $5 THEN now()+interval '1 hour' ELSE now()-interval '1 hour' END,$6)",
    [FILE, PROJECT, OWNER, status, active, accountCleanup ? OWNER : null],
  );
  await db.query("INSERT INTO public.project_file_chunks VALUES($1,'Cedar fixture')", [FILE]);
}
async function claim(db, user = OWNER, attempt = ATTEMPT) {
  return (
    await db.query("SELECT public.claim_stale_project_file_cleanup($1,$2,$3) AS result", [
      user,
      PROJECT,
      attempt,
    ])
  ).rows[0].result;
}
async function rollbackUnchanged(db, expected) {
  assert.deepEqual(
    await targetSnapshot(db),
    expected,
    "refuse changed definition/ACL/OID poststate",
  );
  await db.exec(
    `BEGIN; ${signatures.map((s) => `DROP FUNCTION ${s} RESTRICT;`).join(" ")} COMMIT;`,
  );
}

test("forward embeds the four canonical bodies and no historical backfill or ledger mutation", () => {
  assert.equal(migration.includes(canonical.trim()), true);
  assert.equal(
    hash(migration.match(/EXECUTE \$canonical\$\n([\s\S]*?)\$canonical\$;/u)[1].trim()),
    hash(canonical.trim()),
  );
  assert.doesNotMatch(
    migration,
    /supabase_migrations|ALTER\s+TABLE|CREATE\s+TABLE|INSERT\s+INTO\s+auth\./iu,
  );
  assert.match(migration, /DO \$repair\$/u);
});

test("empty-project failure becomes complete without changing data/helpers/policies/history", async () => {
  const db = await fixture();
  try {
    await assert.rejects(() => claim(db), /does not exist/u);
    const before = await preservedSnapshot(db);
    await db.exec(migration);
    assert.equal(await countTargets(db), 4);
    assert.deepEqual(await claim(db), { state: "complete" });
    assert.deepEqual(await preservedSnapshot(db), before);
    const catalog = await db.query(
      "SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p WHERE p.proname=ANY($1::text[])",
      [names],
    );
    assert.equal(catalog.rows.length, 4);
    assert.ok(catalog.rows.every((x) => !x.anon && !x.authenticated && x.service));
    await assert.rejects(() => claim(db, OTHER), /project_not_found/u);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(() => claim(db), /permission denied/u);
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

test("installation and exact replay preserve existing nonempty data, function OIDs and ACLs", async () => {
  const db = await fixture();
  try {
    await addFile(db, { status: "ready" });
    const before = await preservedSnapshot(db);
    await db.exec(migration);
    const first = await targetSnapshot(db);
    await db.exec(migration);
    assert.deepEqual(await targetSnapshot(db), first);
    assert.deepEqual(await preservedSnapshot(db), before);
  } finally {
    await db.close();
  }
});

for (const options of [
  { status: "pending", active: true },
  { status: "deleting", active: true },
  { status: "pending", accountCleanup: true },
  { status: "ready" },
])
  test(`claim excludes ${JSON.stringify(options)}`, async () => {
    const db = await fixture();
    try {
      await addFile(db, options);
      await db.exec(migration);
      const before = await preservedSnapshot(db);
      assert.deepEqual(await claim(db), { state: "complete" });
      assert.deepEqual(await preservedSnapshot(db), before);
    } finally {
      await db.close();
    }
  });

for (const status of ["pending", "upload_failed", "cleanup_failed", "deleting"])
  test(`expired ${status} uses matching attempt and bounded renewal/failure`, async () => {
    const db = await fixture();
    try {
      await addFile(db, { status });
      await db.exec(migration);
      const result = await claim(db);
      assert.equal(result.state, "claimed");
      assert.equal(result.cleanupKind, status === "deleting" ? "delete" : "upload");
      assert.equal(
        result[status === "deleting" ? "delete_attempt_id" : "upload_attempt_id"],
        ATTEMPT,
      );
      assert.deepEqual(await claim(db), { state: "complete" });
      assert.equal(
        (
          await db.query("SELECT public.renew_stale_project_file_cleanup($1,$2) AS ok", [
            FILE,
            WRONG,
          ])
        ).rows[0].ok,
        false,
      );
      assert.equal(
        (
          await db.query("SELECT public.fail_stale_project_file_cleanup($1,$2) AS ok", [
            FILE,
            WRONG,
          ])
        ).rows[0].ok,
        false,
      );
      assert.equal(
        (
          await db.query("SELECT public.renew_stale_project_file_cleanup($1,$2) AS ok", [
            FILE,
            ATTEMPT,
          ])
        ).rows[0].ok,
        true,
      );
      assert.equal(
        (
          await db.query("SELECT public.fail_stale_project_file_cleanup($1,$2) AS ok", [
            FILE,
            ATTEMPT,
          ])
        ).rows[0].ok,
        true,
      );
      assert.equal((await claim(db, OWNER, WRONG)).state, "claimed");
    } finally {
      await db.close();
    }
  });

for (const removed of [true, false])
  test(`finalize settles storage exactly once; removed=${removed}`, async () => {
    const db = await fixture();
    try {
      await addFile(db);
      await db.exec(migration);
      await claim(db);
      assert.equal(
        (
          await db.query("SELECT public.finalize_stale_project_file_cleanup($1,$2,$3) AS value", [
            FILE,
            WRONG,
            removed,
          ])
        ).rows[0].value.deleted,
        false,
      );
      const final = (
        await db.query("SELECT public.finalize_stale_project_file_cleanup($1,$2,$3) AS value", [
          FILE,
          ATTEMPT,
          removed,
        ])
      ).rows[0].value;
      assert.deepEqual(final, { deleted: true, idempotent: false, projectId: PROJECT });
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM public.project_file_chunks")).rows[0].n,
        0,
      );
      assert.equal(
        (await db.query("SELECT bytes_used::int AS n FROM public.user_storage")).rows[0].n,
        removed ? 0 : 10,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM public.project_storage_retained_charges"))
          .rows[0].n,
        removed ? 0 : 1,
      );
      assert.deepEqual(
        (
          await db.query("SELECT public.finalize_stale_project_file_cleanup($1,$2,$3) AS value", [
            FILE,
            ATTEMPT,
            removed,
          ])
        ).rows[0].value,
        { deleted: true, idempotent: true },
      );
      assert.equal(
        (await db.query("SELECT bytes_used::int AS n FROM public.user_storage")).rows[0].n,
        removed ? 0 : 10,
      );
    } finally {
      await db.close();
    }
  });

for (const [label, sql, pattern] of [
  [
    "helper body",
    "CREATE OR REPLACE FUNCTION public.lock_project_for_file_operation(p_file_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN NULL;END$$",
    /definition_drift/u,
  ],
  [
    "helper grants",
    "GRANT EXECUTE ON FUNCTION public.lock_project_for_file_operation(uuid) TO authenticated",
    /acl_drift/u,
  ],
  [
    "helper language",
    "DROP FUNCTION public.lock_project_for_file_operation(uuid); CREATE FUNCTION public.lock_project_for_file_operation(p_file_id uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT NULL::uuid$$; REVOKE ALL ON FUNCTION public.lock_project_for_file_operation(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.lock_project_for_file_operation(uuid) TO service_role",
    /definition_drift/u,
  ],
  [
    "column type",
    "ALTER TABLE public.project_files ALTER COLUMN size_bytes TYPE numeric",
    /column_drift/u,
  ],
  [
    "missing column",
    "ALTER TABLE public.project_files DROP COLUMN upload_attempt_id",
    /column_drift/u,
  ],
  [
    "unexpected overload",
    "CREATE FUNCTION public.claim_stale_project_file_cleanup(text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$",
    /overload_drift/u,
  ],
  ["inherited browser service access", "GRANT service_role TO authenticated", /acl_drift/u],
])
  test(`baseline refuses ${label} before creating any target`, async () => {
    const db = await fixture();
    try {
      await db.exec(sql);
      const before = await countTargets(db);
      await assert.rejects(() => db.exec(migration), pattern);
      assert.equal(await countTargets(db), before);
    } finally {
      await db.close();
    }
  });

test("unexpected default grant fails atomically after attempted creation", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "CREATE ROLE extra_role; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO extra_role",
    );
    await assert.rejects(() => db.exec(migration), /acl_drift/u);
    assert.equal(await countTargets(db), 0);
  } finally {
    await db.close();
  }
});

for (const [label, sql, pattern] of [
  ["partial installation", `DROP FUNCTION ${signatures[0]}`, /partial_installation/u],
  [
    "changed target body",
    `CREATE OR REPLACE FUNCTION ${signatures[1].replace("(uuid,uuid)", "(p_file_id uuid,p_attempt_id uuid)")} RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN false;END$$`,
    /definition_drift/u,
  ],
  [
    "changed default",
    canonical.replace(
      "p_storage_removed boolean DEFAULT true",
      "p_storage_removed boolean DEFAULT false",
    ),
    /definition_drift/u,
  ],
  ["browser grant", `GRANT EXECUTE ON FUNCTION ${signatures[1]} TO anon`, /acl_drift/u],
  [
    "extra target overload",
    "CREATE FUNCTION public.renew_stale_project_file_cleanup(text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$",
    /overload_drift/u,
  ],
])
  test(`existing conflict refuses ${label} without replacing functions`, async () => {
    const db = await fixture();
    try {
      await db.exec(canonical);
      await db.exec(sql);
      const before = await targetSnapshot(db);
      await assert.rejects(() => db.exec(migration), pattern);
      assert.deepEqual(await targetSnapshot(db), before);
    } finally {
      await db.close();
    }
  });

test("restricted rollback reverses only unchanged definitions and reinstall restores empty-project operation", async () => {
  const db = await fixture();
  try {
    const before = await preservedSnapshot(db);
    await db.exec(migration);
    const installed = await targetSnapshot(db);
    await rollbackUnchanged(db, installed);
    assert.equal(await countTargets(db), 0);
    assert.deepEqual(await preservedSnapshot(db), before);
    await assert.rejects(() => claim(db), /does not exist/u);
    await db.exec(migration);
    assert.deepEqual(await claim(db), { state: "complete" });
  } finally {
    await db.close();
  }
});

test("rollback refuses changed poststate and RESTRICT retains dependent objects", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const installed = await targetSnapshot(db);
    await db.exec(`GRANT EXECUTE ON FUNCTION ${signatures[0]} TO anon`);
    await assert.rejects(() => rollbackUnchanged(db, installed), /refuse changed/u);
    await db.exec(`REVOKE EXECUTE ON FUNCTION ${signatures[0]} FROM anon`);
    await db.exec(
      "CREATE VIEW public.cleanup_dependency AS SELECT public.renew_stale_project_file_cleanup(NULL::uuid,NULL::uuid)",
    );
    const dependentSnapshot = await targetSnapshot(db);
    await assert.rejects(() => rollbackUnchanged(db, dependentSnapshot), /depend/u);
    await db.exec("ROLLBACK");
    assert.equal(await countTargets(db), 4);
  } finally {
    await db.close();
  }
});

test("rollback refuses a default-only change with canonical body and ACLs unchanged", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const installed = await targetSnapshot(db);
    await db.exec(
      canonical.replace(
        "p_storage_removed boolean DEFAULT true",
        "p_storage_removed boolean DEFAULT false",
      ),
    );
    await assert.rejects(() => rollbackUnchanged(db, installed), /refuse changed/u);
    assert.equal(await countTargets(db), 4);
  } finally {
    await db.close();
  }
});
