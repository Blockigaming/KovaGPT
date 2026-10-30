import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const modulePath = fileURLToPath(
  new URL("../../scripts/release/extension-relation-query-hooks.py", import.meta.url),
);
const python = spawnSync(
  "python3",
  [
    "-c",
    "import importlib.util,sys; s=importlib.util.spec_from_file_location('hooks',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.STRUCTURAL_CTES)",
    modulePath,
  ],
  { encoding: "utf8" },
);
assert.equal(python.status, 0, python.stderr);
const ctes = python.stdout.trim();

async function fixture(shift) {
  const db = await PGlite.create();
  for (let i = 0; i < shift; i++)
    await db.exec(
      `CREATE FUNCTION public.shift_${i}() RETURNS integer LANGUAGE sql AS 'SELECT ${i}';`,
    );
  await db.exec(`
    CREATE SCHEMA relation_hook_fixture;
    CREATE TABLE relation_hook_fixture.surface(id integer, body text);
    CREATE TYPE relation_hook_fixture.record_type AS (value integer);
    CREATE TABLE relation_hook_fixture.unrelated(id integer);
  `);
  const ids = (
    await db.query(`
    SELECT 'relation_hook_fixture.surface'::regclass::oid::integer AS parent,
      c.reltoastrelid::integer AS toast,
      (SELECT indexrelid::integer FROM pg_index WHERE indrelid=c.reltoastrelid) AS toast_index,
      (SELECT typrelid::integer FROM pg_type WHERE oid='relation_hook_fixture.record_type'::regtype) AS composite,
      'relation_hook_fixture.unrelated'::regclass::oid::integer AS unrelated
    FROM pg_class c WHERE c.oid='relation_hook_fixture.surface'::regclass
  `)
  ).rows[0];
  return { db, ids };
}

function query(ids) {
  for (const value of Object.values(ids)) assert.ok(Number.isInteger(value) && value > 0);
  const rows = [ids.parent, ids.toast, ids.toast_index, ids.composite].map(
    (id) => `('pg_catalog.pg_class'::regclass::oid,${id}::oid,0)`,
  );
  rows.push(`('pg_catalog.pg_class'::regclass::oid,${ids.parent}::oid,2)`);
  return `WITH RECURSIVE raw_addresses(classid,objid,objsubid) AS (VALUES ${rows.join(",")}),
    ${ctes}
    SELECT jsonb_build_object(
      'relations',(SELECT jsonb_object_agg(label,jsonb_build_object('identity',m.identity,'proven',m.proven))
        FROM (VALUES ('parent',${ids.parent}),('toast',${ids.toast}),('index',${ids.toast_index}),('composite',${ids.composite})) wanted(label,oid)
        LEFT JOIN relation_identity_map m USING(oid)),
      'column',(SELECT jsonb_build_object('identity',identity,'proven',proven) FROM column_identity_map WHERE oid=${ids.parent} AND subid=2),
      'unrelatedIncluded',EXISTS(SELECT 1 FROM relation_identity_map WHERE oid=${ids.unrelated})
    ) AS result`;
}

test("native structural metadata keys survive shifted OIDs and reject unproved TOAST structure", async (t) => {
  const a = await fixture(0);
  const b = await fixture(17);
  t.after(async () => {
    await a.db.close();
    await b.db.close();
  });
  assert.notEqual(a.ids.parent, b.ids.parent);
  const observe = async (f) => (await f.db.query(query(f.ids))).rows[0].result;
  const first = await observe(a);
  assert.deepEqual(first, await observe(b));
  assert.equal(first.unrelatedIncluded, false);
  assert.ok(Object.values(first.relations).every((r) => r.proven === true));
  assert.equal(first.relations.toast.identity.derived, "owned-toast-relation");
  assert.equal(first.relations.index.identity.kind, "index");
  assert.equal(first.relations.composite.identity.derived, "composite-relation");
  assert.equal(first.column.identity.derived, "relation-column");
  assert.equal(first.column.identity.nameHex, Buffer.from("body").toString("hex"));

  const mutation = async (sql, verify) => {
    await a.db.exec("BEGIN");
    try {
      await a.db.exec(sql);
      verify(await observe(a));
    } finally {
      await a.db.exec("ROLLBACK");
    }
  };
  await mutation(
    `UPDATE pg_class SET relname='renamed_fixture_toast' WHERE oid=${a.ids.toast}`,
    (r) => {
      assert.equal(r.relations.toast.proven, false);
      assert.equal(r.relations.index.proven, false);
    },
  );
  await mutation(
    `UPDATE pg_class SET reltoastrelid=${a.ids.toast} WHERE oid=${a.ids.unrelated}`,
    (r) => {
      assert.equal(r.relations.toast.proven, false);
    },
  );
  await mutation(
    `UPDATE pg_index SET indisvalid=false WHERE indexrelid=${a.ids.toast_index}`,
    (r) => {
      assert.equal(r.relations.index.proven, false);
    },
  );
  await mutation(`UPDATE pg_class SET reltype=0 WHERE oid=${a.ids.composite}`, (r) => {
    assert.equal(r.relations.composite.proven, false);
  });
  await mutation(
    `UPDATE pg_attribute SET attisdropped=true WHERE attrelid=${a.ids.parent} AND attnum=2`,
    (r) => {
      assert.equal(r.column.proven, false);
    },
  );
  assert.deepEqual(first, await observe(a));
  const version = Number((await a.db.query("SHOW server_version_num")).rows[0].server_version_num);
  const release = fileURLToPath(new URL("../../scripts/release/", import.meta.url));
  const generated = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
def load(name,file):
 s=importlib.util.spec_from_file_location(name,root/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('lazy_relations','extension-relation-payloads.py')
c=load('lazy_core','extension-routine-type-payloads.py')
g=load('lazy_generator','extension-routine-type-hash-query.py')
print(r.lazy_reference_query([('pg_class',int(sys.argv[2]),2)],c,g))
`,
      release,
      String(a.ids.parent),
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  await a.db.exec(
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL kova.private_extension_wire='PRIVATE_GHA_CAPTURE_ONLY';",
  );
  try {
    const result = JSON.parse(Object.values((await a.db.query(generated.stdout)).rows[0])[0]);
    if (version !== 170006) {
      assert.equal(result.privateRawWire, false);
      assert.equal(result.ok, false);
      assert.equal(result.qualificationReady, false);
      assert.equal(JSON.stringify(result).includes("relation_hook_fixture"), false);
    }
  } finally {
    await a.db.exec("ROLLBACK");
  }
  t.diagnostic(`Synthetic embedded PG ${version}; no native PG17 or production execution.`);
});
