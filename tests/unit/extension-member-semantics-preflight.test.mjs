import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(
  new URL("../../scripts/release/extension-member-semantics-preflight.sql", import.meta.url),
  "utf8",
);
const preflight = async (db) => JSON.parse((await db.query(sql)).rows[0].jsonb_build_object);

async function syntheticDatabase(shiftObjects = 0) {
  const db = await PGlite.create();
  await db.exec("CREATE SCHEMA shifted_private_fixture;");
  for (let i = 0; i < shiftObjects; i++) {
    await db.exec(
      `CREATE FUNCTION shifted_private_fixture.shift_${i}() RETURNS integer LANGUAGE sql AS 'SELECT ${i}';`,
    );
  }
  await db.exec(`
    CREATE SCHEMA member_fixture;
    CREATE FUNCTION member_fixture.member(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1 + 1';
    ALTER EXTENSION plpgsql ADD FUNCTION member_fixture.member(integer);
  `);
  return db;
}

test("extension preflight is an OID-independent inventory, with explicit semantic blockers", async (t) => {
  const a = await syntheticDatabase();
  const b = await syntheticDatabase(17);
  t.after(async () => {
    await a.close();
    await b.close();
  });
  const lookup = async (db) =>
    (await db.query("SELECT 'member_fixture.member(integer)'::regprocedure::oid AS oid")).rows[0]
      .oid;

  await t.test(
    "shifted catalog OIDs preserve complete member and dependency identities",
    async () => {
      assert.notEqual(await lookup(a), await lookup(b));
      const x = await preflight(a);
      const y = await preflight(b);
      assert.equal(x.memberInventorySha256, y.memberInventorySha256);
      assert.equal(x.dependencyInventorySha256, y.dependencyInventorySha256);
      assert.equal(x.counts.unresolvedOrNonRoundtrippableAddresses, 0);
      assert.equal(x.counts.unsupportedInventoryClasses, 0);
      assert.ok(x.counts.unimplementedPayloadObjects > 0);
      assert.equal(
        x.serverVersionNum,
        Number((await a.query("SHOW server_version_num")).rows[0].server_version_num),
      );
      t.diagnostic(
        `Synthetic embedded PG ${x.serverVersionNum}; native PG17 qualification has not run.`,
      );
    },
  );

  await t.test("matching inventory never proves an unchanged function body", async () => {
    const before = await preflight(a);
    await a.exec(
      "CREATE OR REPLACE FUNCTION member_fixture.member(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1 + 999 /* SYNTHETIC_PRIVATE_BODY_LITERAL */';",
    );
    const after = await preflight(a);
    assert.equal(before.memberInventorySha256, after.memberInventorySha256);
    assert.equal(before.dependencyInventorySha256, after.dependencyInventorySha256);
    for (const key of [
      "qualified",
      "qualificationReady",
      "semanticEqualityProven",
      "catalogPayloadAdaptersImplemented",
      "deparsedDdlTreatedAsExact",
    ]) {
      assert.equal(after[key], false);
    }
    assert.equal(JSON.stringify(after).includes("SYNTHETIC_PRIVATE_BODY_LITERAL"), false);
    assert.equal(JSON.stringify(after).includes("member_fixture"), false);
  });

  await t.test(
    "added member or changed referenced identity changes the inventory proof",
    async () => {
      const before = await preflight(b);
      await b.exec(
        "CREATE FUNCTION member_fixture.other_member(text) RETURNS text LANGUAGE sql AS 'SELECT $1'; ALTER EXTENSION plpgsql ADD FUNCTION member_fixture.other_member(text);",
      );
      const after = await preflight(b);
      assert.notEqual(before.memberInventorySha256, after.memberInventorySha256);
      assert.notEqual(before.dependencyInventorySha256, after.dependencyInventorySha256);
    },
  );

  await t.test(
    "opaque SQL bodies and member table modifications are counted without exposing literals",
    async () => {
      await b.exec(`
      CREATE FUNCTION member_fixture.parsed_body() RETURNS integer LANGUAGE sql RETURN 42;
      ALTER EXTENSION plpgsql ADD FUNCTION member_fixture.parsed_body();
      CREATE TABLE member_fixture.member_table(id integer DEFAULT 42, body text);
      ALTER EXTENSION plpgsql ADD TABLE member_fixture.member_table;
      CREATE INDEX member_extra_index ON member_fixture.member_table(id);
      ALTER TABLE member_fixture.member_table ENABLE ROW LEVEL SECURITY;
      CREATE POLICY private_policy ON member_fixture.member_table USING (body='SYNTHETIC_PRIVATE_POLICY_LITERAL');
    `);
      const result = await preflight(b);
      assert.ok(
        result.opaqueFieldCounts.some((r) => r.field === "pg_proc.prosqlbody" && r.count > 0),
      );
      assert.ok(
        result.opaqueFieldCounts.some((r) => r.field === "pg_attrdef.adbin" && r.count > 0),
      );
      assert.ok(
        result.opaqueFieldCounts.some((r) => r.field === "pg_policy.polqual" && r.count > 0),
      );
      assert.ok(result.classCounts.some((r) => r.catalog === "pg_policy"));
      assert.ok(result.counts.unstablePhysicalNames > 0);
      assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE_POLICY_LITERAL"), false);
      assert.equal(JSON.stringify(result).includes("private_policy"), false);
      assert.equal(result.customerRowsRead, false);
      assert.equal(result.productionMutated, false);
      assert.equal(result.rawMetadataReturned, false);
      assert.equal(result.qualificationReady, false);
    },
  );

  await t.test("an unimplemented object class is retained as an explicit blocker", async () => {
    await b.exec(`
      CREATE FUNCTION member_fixture.event_noop() RETURNS event_trigger LANGUAGE plpgsql AS 'BEGIN RETURN; END';
      CREATE EVENT TRIGGER unsupported_extension_event ON ddl_command_end EXECUTE FUNCTION member_fixture.event_noop();
      ALTER EXTENSION plpgsql ADD EVENT TRIGGER unsupported_extension_event;
    `);
    const result = await preflight(b);
    assert.ok(
      result.classCounts.some(
        (r) => r.catalog === "pg_event_trigger" && r.inventorySupported === false,
      ),
    );
    assert.ok(result.counts.unsupportedInventoryClasses > 0);
    assert.ok(result.counts.unresolvedOrNonRoundtrippableAddresses > 0);
    assert.equal(result.qualificationReady, false);
    assert.equal(JSON.stringify(result).includes("unsupported_extension_event"), false);
  });
});
