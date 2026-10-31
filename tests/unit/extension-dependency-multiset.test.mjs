import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const source = fileURLToPath(
  new URL("../../scripts/release/extension-semantic-capture.py", import.meta.url),
);
const generated = spawnSync(
  "python3",
  [
    "-c",
    `import importlib.util,sys
s=importlib.util.spec_from_file_location('dependency_sql_guard',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
q=m.generator.build_capture_all_private_wire_query(**m.relations.capture_query_options(m.core,m.generator))
start=q.index('duplicate_row_keys AS (');end=q.index('\\nprivate_references AS (',start)
print(q[start:end].removesuffix(','))`,
    source,
  ],
  { encoding: "utf8" },
);
assert.equal(generated.status, 0, generated.stderr);
const guard = generated.stdout.trim();

test("dependency SQL guard preserves identical rows and rejects conflicting or ordinary duplicates", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  const observe = async (rows) => {
    const values = rows.map(([catalog, extension, key, value]) => {
      assert.ok(["pg_depend", "pg_proc"].includes(catalog));
      assert.ok(Number.isInteger(extension) && Number.isInteger(key) && Number.isInteger(value));
      return `('${catalog}',${extension},'${key}'::jsonb,'${value}'::jsonb)`;
    });
    return (
      await db.query(`WITH private_rows(catalog,extensionoid,row_identity,wire) AS
        (VALUES ${values.join(",")}), ${guard}
        SELECT (SELECT count(*)::int FROM private_rows) AS retained,
          (SELECT count(*)::int FROM duplicate_row_keys) AS conflicts`)
    ).rows[0];
  };
  assert.deepEqual(
    await observe([
      ["pg_depend", 1, 10, 100],
      ["pg_depend", 1, 10, 100],
    ]),
    { retained: 2, conflicts: 0 },
  );
  assert.deepEqual(
    await observe([
      ["pg_depend", 1, 10, 100],
      ["pg_depend", 1, 10, 101],
    ]),
    { retained: 2, conflicts: 1 },
  );
  assert.deepEqual(
    await observe([
      ["pg_proc", 1, 10, 100],
      ["pg_proc", 1, 10, 100],
    ]),
    { retained: 2, conflicts: 1 },
  );
  assert.deepEqual(
    await observe([
      ["pg_depend", 1, 10, 100],
      ["pg_depend", 2, 10, 101],
      ["pg_proc", 1, 10, 100],
    ]),
    { retained: 3, conflicts: 0 },
  );
  t.diagnostic("Synthetic embedded SQL guard only; no source connection or restore qualification.");
});
