import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Real embedded PostgreSQL COPY/extension catalogs with synthetic values.
// This does not exercise native PG17 clients, exported snapshots or encryption.
const script = fileURLToPath(
  new URL("../../scripts/release/managed-auth-recovery.py", import.meta.url),
);
function python(command, value) {
  const child = spawnSync(
    "python3",
    [
      "-c",
      [
        "import importlib.util,json,sys",
        "s=importlib.util.spec_from_file_location('extension_recovery',sys.argv[1])",
        "m=importlib.util.module_from_spec(s);s.loader.exec_module(m)",
        command,
      ].join("\n"),
      script,
    ],
    { input: JSON.stringify(value), encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("extension COPY preserves real text, arrays, bytea, generated values and sequence state", async (t) => {
  const source = new PGlite();
  const target = new PGlite();
  t.after(async () => {
    await source.close();
    await target.close();
  });
  t.diagnostic(
    `Embedded SQL engine server_version_num=${(await source.query("SELECT current_setting('server_version_num') AS v")).rows[0].v}; native PG17 qualification remains separate.`,
  );
  const schema = `CREATE SCHEMA extension_fixture;
    CREATE TABLE extension_fixture.referenced (id int PRIMARY KEY);
    CREATE TABLE extension_fixture.records (
      id int GENERATED ALWAYS AS IDENTITY,
      label text,
      labels text[],
      bytes bytea,
      reference_id int REFERENCES extension_fixture.referenced(id),
      doubled int GENERATED ALWAYS AS (id * 2) STORED
    );
    CREATE TABLE extension_fixture.empty_ephemeral (label text);
    CREATE TABLE extension_fixture.parent (label text);
    CREATE TABLE extension_fixture.child () INHERITS (extension_fixture.parent);
    CREATE SEQUENCE extension_fixture.counter;
    ALTER EXTENSION plpgsql ADD TABLE extension_fixture.records;
    ALTER EXTENSION plpgsql ADD TABLE extension_fixture.empty_ephemeral;
    ALTER EXTENSION plpgsql ADD TABLE extension_fixture.parent;
    ALTER EXTENSION plpgsql ADD SEQUENCE extension_fixture.counter;`;
  await source.exec(schema);
  // Deliberately allocate different target OIDs before constructing its schema.
  await target.exec("CREATE TABLE oid_padding(a int); DROP TABLE oid_padding;");
  await target.exec(schema);
  const labels = [
    "first\nline\tfield\\backslash",
    "\\.\nSELECT 'data stays data';",
    null,
    "Unicode ✓",
    "SELECT pg_catalog.setval('extension_fixture.counter', 999, true);",
  ];
  for (const label of labels) {
    await source.query(
      "INSERT INTO extension_fixture.records(label,labels,bytes) VALUES($1,$2,$3)",
      [label, ["one", "two\nlines", "\\N"], new Uint8Array([0, 9, 10, 92, 255])],
    );
  }
  await source.query("SELECT pg_catalog.setval('extension_fixture.counter',93,true)");
  await source.query("INSERT INTO extension_fixture.parent VALUES('parent physical row')");
  await source.query("INSERT INTO extension_fixture.child VALUES('child physical row')");
  // The nonextension child is restored by the main pg_dump data path.
  await target.query("INSERT INTO extension_fixture.child VALUES('child physical row')");
  const sql = python("print(json.dumps(m.EXTENSION_DATA_CATALOG_SQL))", null);
  const decode = async (db) => JSON.parse(Object.values((await db.query(sql)).rows[0])[0]);
  const metadata = await decode(source);
  assert.deepEqual(await decode(target), metadata);
  assert.ok(metadata.some((r) => r.name === "records_id_seq" && r.kind === "S"));
  const catalog = {
    extensions: [{ name: "plpgsql" }],
    tables: metadata
      .filter((r) => r.kind === "r")
      .map(({ schema, name, kind }) => ({ schema, name, kind })),
    sequences: (
      await source.query(
        "SELECT n.nspname AS schema,c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='extension_fixture' AND c.relkind='S' ORDER BY c.relname",
      )
    ).rows,
    extensionData: metadata,
  };
  const payload = { format: 1, tables: [], sequences: [] };
  for (const row of metadata) {
    if (row.kind === "r") {
      const columns = row.columns.filter((c) => c.generated === "").map((c) => c.name);
      const copy = await source.query(
        `COPY (SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM ONLY "${row.schema}"."${row.name}") TO '/dev/blob' WITH (FORMAT text)`,
      );
      const raw = copy.blob ? await copy.blob.text() : "";
      if (!copy.blob) assert.equal(copy.rowCount, 0);
      payload.tables.push({
        schema: row.schema,
        name: row.name,
        columns,
        copyText: raw,
        sha256: python("print(json.dumps(m.digest(json.load(sys.stdin).encode())))", raw),
      });
    } else {
      const state = (
        await source.query(
          `SELECT last_value::text AS value,is_called AS called FROM "${row.schema}"."${row.name}"`,
        )
      ).rows[0];
      payload.sequences.push({ schema: row.schema, name: row.name, ...state });
    }
  }
  const restore = python(
    "v=json.load(sys.stdin);print(json.dumps(m.extension_restore_sql(v['catalog'],v['payload']).decode()))",
    { catalog, payload },
  );
  const lines = restore.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("COPY ")) {
      const end = lines.indexOf("\\.", i + 1);
      assert.ok(end > i);
      const raw = lines.slice(i + 1, end).join("\n") + (end > i + 1 ? "\n" : "");
      await target.query(lines[i].replace("FROM stdin", "FROM '/dev/blob'"), [], {
        blob: new Blob([raw]),
      });
      i = end;
    } else if (lines[i].startsWith("SELECT pg_catalog.setval(")) {
      await target.query(lines[i]);
    }
  }
  const before = await source.query("SELECT * FROM extension_fixture.records ORDER BY id");
  const after = await target.query("SELECT * FROM extension_fixture.records ORDER BY id");
  assert.deepEqual(after.rows, before.rows);
  assert.equal(payload.tables.find((r) => r.name === "parent").copyText, "parent physical row\n");
  assert.deepEqual(
    (await target.query("SELECT * FROM extension_fixture.parent ORDER BY label")).rows,
    (await source.query("SELECT * FROM extension_fixture.parent ORDER BY label")).rows,
  );
  for (const row of payload.sequences) {
    assert.deepEqual(
      (
        await target.query(
          `SELECT last_value::text AS value,is_called AS called FROM "${row.schema}"."${row.name}"`,
        )
      ).rows[0],
      { value: row.value, called: row.called },
    );
  }
  assert.equal(
    (await target.query("SELECT count(*)::int AS n FROM extension_fixture.empty_ephemeral")).rows[0]
      .n,
    0,
  );
  // pg_dump does not normally replay modified extension member definitions.
  // Detect incompatible extension defaults and sequence parameters explicitly.
  await target.query(
    "ALTER TABLE extension_fixture.records ALTER COLUMN label SET DEFAULT 'changed default'",
  );
  await target.query("ALTER SEQUENCE extension_fixture.counter INCREMENT BY 2");
  const drifted = await decode(target);
  assert.notDeepEqual(drifted, metadata);
  assert.equal(drifted.find((r) => r.name === "counter").definition.sequence.increment, "2");
  assert.notEqual(
    drifted.find((r) => r.name === "records").columns.find((c) => c.name === "label")
      .defaultExpression,
    metadata.find((r) => r.name === "records").columns.find((c) => c.name === "label")
      .defaultExpression,
  );
});
