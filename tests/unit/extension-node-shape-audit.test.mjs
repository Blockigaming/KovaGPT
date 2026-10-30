import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../../scripts/release/", import.meta.url);
const query = readFileSync(new URL("extension-node-shape-audit.sql", root), "utf8");
const types = readFileSync(new URL("extension-constant-type-shape-audit.sql", root), "utf8");
const byteorder = readFileSync(new URL("extension-datum-byteorder-audit.sql", root), "utf8");
const regclassByteorder = readFileSync(
  new URL("extension-regclass-datum-byteorder-audit.sql", root),
  "utf8",
);

async function execute(db, sql) {
  const results = await db.exec(sql);
  return JSON.parse(
    results.find((r) => r.rows?.[0]?.jsonb_build_object).rows[0].jsonb_build_object,
  );
}

test("node audit exposes public structure and private-name-like tokens only as counts", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA shape_audit_fixture;
    CREATE FUNCTION shape_audit_fixture.defaults(integer DEFAULT 42, text DEFAULT ':SYNTHETIC_PRIVATE_VALUE')
      RETURNS integer LANGUAGE sql AS 'SELECT $1';
    ALTER EXTENSION plpgsql ADD FUNCTION shape_audit_fixture.defaults(integer,text);
    CREATE VIEW shape_audit_fixture.names AS
      SELECT 1 AS ":SYNTHETIC_PRIVATE_FIELD", 2 AS "{SYNTHETIC_PRIVATE_TAG}", 3 AS "private \\ {name}";
    ALTER EXTENSION plpgsql ADD VIEW shape_audit_fixture.names;
  `);
  const shape = await execute(db, query);
  assert.ok(shape.nodeTagCounts.some((r) => r.tag === "CONST"));
  assert.ok(shape.nodeTagCounts.some((r) => r.tag === "QUERY"));
  assert.ok(shape.publicFieldTokenCounts.some((r) => r.key === "consttype"));
  assert.ok(shape.unknownFieldLikeTokenCount > 0);
  assert.equal(shape.fieldTokenScanIsExactParser, false);
  assert.ok(
    shape.catalogColumns.some((r) => r.catalog === "pg_proc" && r.column_name === "proargdefaults"),
  );
  assert.ok(
    shape.catalogForeignKeys.some(
      (r) => r.catalog === "pg_proc" && r.column_names.includes("prorettype"),
    ),
  );
  const text = JSON.stringify(shape);
  for (const value of [
    "SYNTHETIC_PRIVATE_FIELD",
    "SYNTHETIC_PRIVATE_TAG",
    "SYNTHETIC_PRIVATE_VALUE",
    "shape_audit_fixture",
  ]) {
    assert.equal(text.includes(value), false);
  }
  assert.equal(shape.rawNodeValuesReturned, false);
  assert.equal(shape.customerRowsRead, false);
  assert.equal(shape.qualificationReady, false);

  const layouts = await execute(db, types);
  assert.ok(layouts.typeLayouts.some((r) => r.identity.object_names.includes("integer")));
  assert.ok(layouts.typeLayouts.every((r) => !Object.hasOwn(r, "constvalue")));
  assert.equal(layouts.constantValuesReturned, false);
  assert.equal(layouts.datumEncodingIndependentlyVerified, false);
  assert.equal(JSON.stringify(layouts).includes("SYNTHETIC_PRIVATE_VALUE"), false);
  const encoding = await execute(db, byteorder);
  assert.equal(encoding.constantValuesReturned, false);
  assert.equal(encoding.qualificationReady, false);
  if (encoding.validEightByteDatumCount === 0 || encoding.nonAmbiguousCaseCount === 0) {
    assert.equal(encoding.nonAmbiguousLittleEndianProven, false);
    assert.equal(encoding.nonAmbiguousBigEndianProven, false);
  }
  assert.equal(JSON.stringify(encoding).includes("SYNTHETIC_PRIVATE_VALUE"), false);
  await db.exec(
    "CREATE TABLE shape_audit_fixture.serial_fixture(id bigserial); ALTER EXTENSION plpgsql ADD TABLE shape_audit_fixture.serial_fixture;",
  );
  const refs = await execute(db, regclassByteorder);
  assert.equal(refs.pureNextvalCandidateCount, 1);
  assert.equal(refs.uniqueAuthoritativeSequenceLinkCount, 1);
  assert.equal(refs.nonAmbiguousLittleEndianProven, true);
  assert.equal(refs.nonAmbiguousBigEndianProven, false);
  assert.equal(refs.eightByteLittleEndianProven, refs.allObservedDatumsEightBytes);
  assert.equal(refs.constantValuesReturned, false);
  assert.equal(refs.qualificationReady, false);
  assert.equal(JSON.stringify(refs).includes("serial_fixture"), false);
  t.diagnostic(
    `Synthetic embedded PG ${shape.serverVersionNum}; native PG17 evidence is separate.`,
  );
});
