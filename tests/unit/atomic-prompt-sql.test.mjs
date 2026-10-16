import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = readFileSync(
  process.env.KOVA_PROMPT_MIGRATION ??
    "supabase/migrations/20261012031700_atomic_prompt_mutations.sql",
  "utf8",
);
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.projects(id uuid PRIMARY KEY, owner_id uuid); CREATE TABLE public.context_packs(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_project_member(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  await db.exec(readFileSync("supabase/migrations/20260727120000_professional_os.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20260727150000_prompt_studio_2.sql", "utf8"));
  await db.exec(migration);
  await db.exec(
    readFileSync("supabase/migrations/20261012041908_prompt_evaluation_idempotency.sql", "utf8"),
  );
  await db.exec(`GRANT USAGE ON SCHEMA auth, public TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON prompt_templates,prompt_versions,prompt_evaluations TO authenticated;
    INSERT INTO auth.users VALUES('${id(1)}'),('${id(2)}');
    INSERT INTO prompt_templates(id,user_id,name,body,updated_at) VALUES('${id(10)}','${id(1)}','Prompt','original','2026-10-12T00:00:00Z');
    SELECT set_config('request.jwt.claim.sub','${id(1)}',false); SET ROLE authenticated;`);
  return db;
}
const mutate = async (db, changes = {}, expected = null, use = false) =>
  (
    await db.query("SELECT public.mutate_prompt_template($1,$2::timestamptz,$3::jsonb,$4) result", [
      id(10),
      expected,
      JSON.stringify(changes),
      use,
    ])
  ).rows[0].result;
const snapshot = async (db) =>
  (await db.query("SELECT to_jsonb(p) result FROM prompt_templates p WHERE id=$1", [id(10)]))
    .rows[0].result;
const versions = async (db) =>
  (await db.query("SELECT version,body FROM prompt_versions ORDER BY version")).rows;
test("queued SQL usage increments retain every accepted count without changing content or adding history", async () => {
  const db = await setup();
  try {
    await Promise.all(Array.from({ length: 20 }, () => mutate(db, {}, null, true)));
    const row = await snapshot(db);
    assert.equal(row.use_count, 20);
    assert.equal(row.body, "original");
    assert.ok(row.last_used_at);
    assert.deepEqual(await versions(db), []);
    await assert.rejects(mutate(db, { body: "forged" }, null, true), /cannot edit content/);
  } finally {
    await db.close();
  }
});
test("captured revision rejects the second stale edit; version allocation and monotonic revision remain atomic", async () => {
  const db = await setup();
  try {
    const first = await snapshot(db);
    const results = await Promise.allSettled([
      mutate(db, { body: "one" }, first.updated_at),
      mutate(db, { body: "two" }, first.updated_at),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.deepEqual(await versions(db), [{ version: 1, body: "original" }]);
    const saved = await snapshot(db);
    const next = await mutate(db, { body: "three" }, saved.updated_at);
    assert.notEqual(next.updated_at, saved.updated_at);
    assert.deepEqual(
      (await versions(db)).map((r) => r.version),
      [1, 2],
    );
    await assert.rejects(mutate(db, { favorite: true }, saved.updated_at), /Prompt changed/);
    assert.equal((await snapshot(db)).favorite, false);
  } finally {
    await db.close();
  }
});
test("failure after history insertion and interrupted transaction roll back both history and prompt", async () => {
  const db = await setup();
  try {
    await db.exec(`RESET ROLE; CREATE FUNCTION fail_prompt_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.body='fail' THEN RAISE EXCEPTION 'injected interruption'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER inject_prompt_failure AFTER UPDATE ON prompt_templates FOR EACH ROW EXECUTE FUNCTION fail_prompt_update(); SET ROLE authenticated;`);
    const row = await snapshot(db);
    await assert.rejects(mutate(db, { body: "fail" }, row.updated_at), /injected interruption/);
    assert.equal((await snapshot(db)).body, "original");
    assert.deepEqual(await versions(db), []);
    await db.exec("BEGIN");
    await mutate(db, { body: "not committed" }, row.updated_at);
    await db.exec("ROLLBACK");
    assert.equal((await snapshot(db)).body, "original");
    assert.deepEqual(await versions(db), []);
  } finally {
    await db.close();
  }
});
test("RPC preserves owner and RLS boundaries and validates direct invocations", async () => {
  const db = await setup();
  try {
    const row = await snapshot(db);
    for (const value of [
      { variables: [null] },
      { favorite: null },
      { body: "" },
      { user_id: id(2) },
      { variables: "bad" },
    ])
      await assert.rejects(mutate(db, value, row.updated_at), /Invalid prompt/);
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(2)}',false)`);
    await assert.rejects(mutate(db, {}, null, true), /unavailable/);
    await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(mutate(db, {}, null, true), /Authentication required/);
  } finally {
    await db.close();
  }
});

test("child history and evaluation rows cannot reference a different owner's prompt", async () => {
  const db = await setup();
  try {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(2)}',false)`);
    await assert.rejects(
      db.query(
        "INSERT INTO prompt_versions(prompt_id,user_id,version,name,body) VALUES($1,$2,900,'forged','foreign')",
        [id(10), id(2)],
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.query("INSERT INTO prompt_evaluations(prompt_id,user_id,rating) VALUES($1,$2,5)", [
        id(10),
        id(2),
      ]),
      /row-level security/,
    );
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(1)}',false)`);
    await db.query("INSERT INTO prompt_evaluations(prompt_id,user_id,rating) VALUES($1,$2,5)", [
      id(10),
      id(1),
    ]);
    assert.equal(
      (await db.query("SELECT count(*)::int count FROM prompt_evaluations")).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});

test("a stale list snapshot cannot delete a prompt edited by another session", async () => {
  const { loadServerFunctions } = await import("../helpers/server-function-harness.mjs");
  const { deletePromptTemplate } = loadServerFunctions(
    process.env.KOVA_PROMPT_DELETE_SOURCE ?? "src/lib/professional.functions.ts",
  );
  const db = await setup();
  try {
    const old = await snapshot(db);
    const edited = await mutate(db, { body: "newer saved work" }, old.updated_at);
    const searchMigration = readFileSync(
      "supabase/migrations/20260904235854_semantic_workspace_search.sql",
      "utf8",
    );
    const start = searchMigration.indexOf(
      "create function kova_private.invalidate_workspace_search()",
    );
    const end = searchMigration.indexOf("end $$;", start) + "end $$;".length;
    await db.exec(`RESET ROLE; CREATE SCHEMA kova_private;
      CREATE TABLE workspace_search_index(source_table text, source_id uuid);
      CREATE VIEW workspace_search_sources AS SELECT NULL::text source_digest,NULL::uuid owner_id,NULL::text source_table,NULL::uuid source_id WHERE false;
      ${searchMigration.slice(start, end)}
      CREATE TRIGGER workspace_search_invalidation AFTER DELETE ON prompt_templates FOR EACH ROW EXECUTE FUNCTION kova_private.invalidate_workspace_search();
      INSERT INTO workspace_search_index VALUES('prompt_templates','${id(10)}'),('prompt_templates','${id(11)}');
      GRANT SELECT ON workspace_search_index TO authenticated; SET ROLE authenticated;`);

    const client = {
      from(table) {
        assert.equal(table, "prompt_templates");
        const filters = [];
        const query = {
          delete: () => query,
          select: () => query,
          eq: (key, value) => {
            assert.ok(["id", "user_id", "updated_at"].includes(key));
            filters.push([key, value]);
            return query;
          },
          single: () => {
            const pending = db
              .query(
                "DELETE FROM public.prompt_templates WHERE " +
                  filters.map(([key], index) => `${key}=$${index + 1}`).join(" AND ") +
                  " RETURNING id",
                filters.map(([, value]) => value),
              )
              .then(({ rows }) => ({
                data: rows[0] ?? null,
                error: rows.length === 1 ? null : { code: "PGRST116" },
              }));
            return {
              then: pending.then.bind(pending),
              abortSignal: (signal) => {
                assert.equal(signal.aborted, false);
                return pending;
              },
            };
          },
        };
        return query;
      },
    };
    const context = { supabase: client, userId: id(1) };
    await assert.rejects(
      deletePromptTemplate({ data: { id: id(10), expectedUpdatedAt: old.updated_at }, context }),
      /Prompt changed|Review saved prompt/,
    );
    assert.equal((await snapshot(db)).body, "newer saved work");
    await assert.rejects(deletePromptTemplate({ data: { id: id(10) }, context }));
    await deletePromptTemplate({
      data: { id: id(10), expectedUpdatedAt: edited.updated_at },
      context,
    });
    assert.equal(
      (await db.query("SELECT count(*)::int count FROM prompt_templates")).rows[0].count,
      0,
    );
    assert.deepEqual(await versions(db), []);
    assert.deepEqual((await db.query("SELECT source_id FROM workspace_search_index")).rows, [
      { source_id: id(11) },
    ]);
  } finally {
    await db.close();
  }
});

const evaluate = async (db, requestId = id(30), promptId = id(10), rating = 4, notes = "useful") =>
  (
    await db.query("SELECT public.record_prompt_evaluation($1,$2,$3,$4) result", [
      requestId,
      promptId,
      rating,
      notes,
    ])
  ).rows[0].result;
test("evaluation request key replays one durable row and rejects changed payload or foreign parent", async () => {
  const db = await setup();
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => evaluate(db)));
    assert.equal(new Set(results.map((row) => row.id)).size, 1);
    assert.equal((await db.query("select count(*)::int n from prompt_evaluations")).rows[0].n, 1);
    await assert.rejects(evaluate(db, id(30), id(10), 5), /different content/);
    await assert.rejects(evaluate(db, id(31), id(99)), /Prompt unavailable/);
    await db.exec("BEGIN");
    await evaluate(db, id(32));
    await db.exec("ROLLBACK");
    assert.equal((await db.query("select count(*)::int n from prompt_evaluations")).rows[0].n, 1);
    await db.exec(`select set_config('request.jwt.claim.sub','${id(2)}',false)`);
    await assert.rejects(evaluate(db), /Prompt unavailable/);
  } finally {
    await db.close();
  }
});
test("legacy foreign-owner history remains hidden but blocks version allocation until approved repair", async () => {
  const db = await setup();
  try {
    await db.exec(
      `RESET ROLE; INSERT INTO prompt_versions(prompt_id,user_id,version,name,body) VALUES('${id(10)}','${id(2)}',1,'legacy foreign','foreign content'); SET ROLE authenticated;`,
    );
    assert.deepEqual(await versions(db), []);
    const prior = await snapshot(db);
    await assert.rejects(
      mutate(db, { body: "legitimate edit" }, prior.updated_at),
      /duplicate key value/,
    );
    assert.equal((await snapshot(db)).body, "original");
    await db.exec("RESET ROLE");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM prompt_versions v JOIN prompt_templates p ON p.id=v.prompt_id WHERE v.user_id IS DISTINCT FROM p.user_id",
        )
      ).rows[0].n,
      1,
    );
    await db.exec(readFileSync("docs/release/prompt-legacy-ownership-preflight.sql", "utf8"));
    assert.equal((await db.query("SELECT count(*)::int n FROM prompt_versions")).rows[0].n, 1);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      db.exec(readFileSync("docs/release/prompt-legacy-ownership-preflight.sql", "utf8")),
      /all-owner visibility/,
    );
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
