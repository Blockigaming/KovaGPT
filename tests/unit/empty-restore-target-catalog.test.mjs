import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { validateObservation } from "../../scripts/release/verify-isolated-restore-target.mjs";

const sql = readFileSync(
  new URL("../../scripts/release/empty-restore-target-catalog.sql", import.meta.url),
  "utf8",
);

test("all recovery address projections return bare hosts without relaxing exact target identity", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  const version = (await db.query("SHOW server_version_num")).rows[0].server_version_num;
  t.diagnostic(
    `Embedded PostgreSQL ${version}; this fixture is not native PostgreSQL 17 qualification.`,
  );
  const projections = [];
  for (const [name, count] of [
    ["probe-empty-recovery-target.py", 1],
    ["operator-recovery-probe.py", 1],
    ["managed-auth-recovery.py", 2],
    ["verify-isolated-restore-target.mjs", 1],
  ]) {
    const source = readFileSync(new URL(`../../scripts/release/${name}`, import.meta.url), "utf8");
    const matches = [
      ...source.matchAll(
        /'(?:address|serverAddress)',\s*(host\(inet_server_addr\(\)\)|inet_server_addr\(\)::text)/g,
      ),
    ];
    assert.equal(matches.length, count, name);
    for (const match of matches) {
      assert.equal(match[1], "host(inet_server_addr())", name);
      projections.push(match[1]);
    }
  }
  assert.equal(projections.length, 5);
  for (const address of ["172.30.240.2", "fd68:6b6f:7661:240::2"]) {
    const approved = {
      database: "postgres",
      expectedIp: address,
      port: 5432,
      expectedSystemId: "123456789",
    };
    const observation = {
      database: "postgres",
      serverAddress: address,
      serverPort: 5432,
      systemIdentifier: "123456789",
      serverVersionNum: 170006,
      authUsers: 0,
      authIdentities: 0,
      authSessions: 0,
      storageBuckets: 0,
      storageObjects: 0,
      applicationRelations: 0,
      extensions: [],
    };
    for (const projection of projections) {
      const expression = projection.replace("inet_server_addr()", "$1::inet");
      const value = (
        await db.query(`SELECT ${expression} AS projected, $1::inet::text AS legacy`, [address])
      ).rows[0];
      assert.equal(value.projected, address);
      assert.ok(isIP(value.projected));
      assert.equal(value.legacy, `${address}/${isIP(address) === 4 ? 32 : 128}`);
      assert.equal(isIP(value.legacy), 0);
      assert.equal(
        validateObservation({ ...observation, serverAddress: value.projected }, approved, [])
          .serverAddress,
        address,
      );
      assert.throws(() =>
        validateObservation({ ...observation, serverAddress: value.legacy }, approved, []),
      );
    }
    for (const changed of [
      { serverAddress: address === "172.30.240.2" ? "172.30.240.3" : "fd68:6b6f:7661:240::3" },
      { serverAddress: `${address}/24` },
      { systemIdentifier: "987654321" },
      { serverPort: 5433 },
      { database: "other" },
      { authUsers: 1 },
    ])
      assert.throws(() => validateObservation({ ...observation, ...changed }, approved, []));
  }
});

test("empty-target census retains unknown objects and binds extension internals conservatively", async (t) => {
  // These are disposable embedded PostgreSQL fixtures, never production or a
  // real recovery target. The runtime version is reported rather than passed
  // off as native PostgreSQL 17 qualification.
  const db = await PGlite.create();
  t.after(() => db.close());
  const census = async () => {
    const result = await db.query(sql);
    assert.equal(result.rows.length, 1);
    return JSON.parse(result.rows[0].jsonb_build_object);
  };
  const fixture = async (fn) => {
    await db.exec("BEGIN");
    try {
      await fn();
    } finally {
      await db.exec("ROLLBACK");
    }
  };

  await t.test(
    "reports actual version and metadata-only limits without declaring qualification",
    async () => {
      const actual = await census();
      assert.equal(actual.format, 1);
      assert.equal(
        actual.serverVersionNum,
        Number((await db.query("SHOW server_version_num")).rows[0].server_version_num),
      );
      assert.equal(actual.counts.unownedNamespaceObjects, 0);
      assert.equal(actual.counts.tables, 0);
      assert.equal(actual.completeness.tableDataChecked, false);
      assert.equal(actual.completeness.extensionMembershipAloneQualified, false);
      assert.equal(Object.hasOwn(actual, "qualified"), false);
      assert.ok(actual.namespaces.some((n) => n.name === "public"));
      assert.ok(actual.globalObjects.some((o) => o.catalog === "pg_cast"));
      assert.match(actual.structuralCatalogs.systemNamespaceObjectsSha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(await census(), actual);
      t.diagnostic(
        `Embedded PostgreSQL ${actual.serverVersionNum}; native 17 execution is not established.`,
      );
    },
  );

  await t.test(
    "finds relations, routines, types, policies, triggers and indexes in a hidden schema",
    async () =>
      fixture(async () => {
        await db.exec(`
      CREATE SCHEMA hidden_census;
      CREATE TABLE hidden_census.records(id integer PRIMARY KEY, body text);
      INSERT INTO hidden_census.records VALUES (1, 'SYNTHETIC_ROW_MUST_NOT_APPEAR');
      CREATE VIEW hidden_census.visible_records AS SELECT * FROM hidden_census.records;
      CREATE SEQUENCE hidden_census.extra_sequence;
      CREATE TYPE hidden_census.flavor AS ENUM ('synthetic');
      CREATE DOMAIN hidden_census.positive_int AS integer CHECK (VALUE > 0);
      CREATE FUNCTION hidden_census.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER touch BEFORE INSERT ON hidden_census.records FOR EACH ROW EXECUTE FUNCTION hidden_census.touch();
      ALTER TABLE hidden_census.records ENABLE ROW LEVEL SECURITY;
      CREATE POLICY owned_rows ON hidden_census.records USING (false);
      CREATE INDEX extra_body ON hidden_census.records(body);
    `);
        const actual = await census();
        for (const catalog of [
          "pg_class",
          "pg_proc",
          "pg_type",
          "pg_policy",
          "pg_trigger",
          "pg_constraint",
          "pg_rewrite",
        ]) {
          assert.ok(
            actual.namespaceObjects.some(
              (o) => o.catalog === catalog && o.schema === "hidden_census",
            ),
            catalog,
          );
        }
        assert.ok(actual.tables.some((o) => o.schema === "hidden_census" && o.name === "records"));
        assert.ok(actual.counts.unownedNamespaceObjects > 0);
        assert.ok(actual.counts.nonExtensionTables > 0);
        assert.equal(JSON.stringify(actual).includes("SYNTHETIC_ROW_MUST_NOT_APPEAR"), false);
      }),
  );

  await t.test("does not lose an object with no dependency rows", async () =>
    fixture(async () => {
      await db.exec(`
      CREATE SCHEMA dependencyless_census;
      CREATE FUNCTION dependencyless_census.unknown_object() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
      DELETE FROM pg_catalog.pg_depend WHERE classid='pg_catalog.pg_proc'::regclass
        AND objid='dependencyless_census.unknown_object()'::regprocedure;
    `);
      const actual = await census();
      const routine = actual.namespaceObjects.find(
        (o) => o.catalog === "pg_proc" && o.schema === "dependencyless_census",
      );
      assert.ok(routine);
      assert.equal(routine.directExtension, null);
      assert.equal(routine.internalExtension, null);
      assert.ok(actual.counts.unownedNamespaceObjects > 0);
    }),
  );

  await t.test("recognizes only internally generated extension types", async () =>
    fixture(async () => {
      await db.exec(`
      CREATE SCHEMA extension_census;
      CREATE TYPE extension_census.flavor AS ENUM ('synthetic');
      ALTER EXTENSION plpgsql ADD TYPE extension_census.flavor;
      -- ALTER EXTENSION also records this particular array as a direct
      -- member. Retain its real INTERNAL edge but remove the direct edge in
      -- this disposable catalog fixture to exercise indirect membership.
      DELETE FROM pg_catalog.pg_depend
      WHERE classid='pg_catalog.pg_type'::regclass AND deptype='e'
        AND objid=(SELECT typarray FROM pg_catalog.pg_type WHERE oid='extension_census.flavor'::regtype);
    `);
      const actual = await census();
      const type = actual.namespaceObjects.find(
        (o) => o.catalog === "pg_type" && o.identity === "extension_census.flavor",
      );
      const array = actual.namespaceObjects.find(
        (o) => o.catalog === "pg_type" && o.identity === "extension_census.flavor[]",
      );
      assert.equal(type.directExtension, "plpgsql");
      assert.equal(array.directExtension, null);
      assert.equal(array.internalExtension, "plpgsql");
      assert.equal(actual.counts.unownedNamespaceObjects, 0);
      assert.equal(actual.completeness.extensionMembershipAloneQualified, false);
    }),
  );

  await t.test(
    "does not inherit extension permission through trigger/policy auto-dependencies",
    async () =>
      fixture(async () => {
        await db.exec(`
      CREATE SCHEMA extension_census;
      CREATE TABLE extension_census.records(id integer);
      ALTER EXTENSION plpgsql ADD TABLE extension_census.records;
      CREATE FUNCTION extension_census.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      ALTER EXTENSION plpgsql ADD FUNCTION extension_census.touch();
      CREATE TRIGGER custom_touch BEFORE INSERT ON extension_census.records FOR EACH ROW EXECUTE FUNCTION extension_census.touch();
      ALTER TABLE extension_census.records ENABLE ROW LEVEL SECURITY;
      CREATE POLICY custom_policy ON extension_census.records USING (true);
      ALTER TABLE extension_census.records ADD CONSTRAINT custom_check CHECK (id > 0);
      CREATE INDEX custom_index ON extension_census.records(id);
    `);
        const actual = await census();
        for (const catalog of ["pg_trigger", "pg_policy", "pg_constraint"]) {
          const object = actual.namespaceObjects.find(
            (o) => o.catalog === catalog && o.schema === "extension_census",
          );
          assert.ok(object, catalog);
          assert.equal(object.directExtension, null, catalog);
          assert.equal(object.internalExtension, null, catalog);
        }
        const index = actual.namespaceObjects.find(
          (o) => o.catalog === "pg_class" && o.identity === "extension_census.custom_index",
        );
        assert.equal(index.internalExtension, null);
        assert.ok(actual.counts.unownedNamespaceObjects >= 4);
      }),
  );

  await t.test("fingerprints intrinsic column changes on an extension-owned table", async () =>
    fixture(async () => {
      await db.exec(
        "CREATE SCHEMA extension_census; CREATE TABLE extension_census.records(id integer); ALTER EXTENSION plpgsql ADD TABLE extension_census.records",
      );
      const before = await census();
      await db.exec(
        "ALTER TABLE extension_census.records ADD COLUMN unreviewed text DEFAULT 'SYNTHETIC_DEFINITION_MUST_NOT_APPEAR'",
      );
      const after = await census();
      const table = (c) =>
        c.namespaceObjects.find(
          (o) => o.catalog === "pg_class" && o.identity === "extension_census.records",
        );
      assert.notEqual(
        table(before).details.catalogRowSha256,
        table(after).details.catalogRowSha256,
      );
      assert.equal(JSON.stringify(after).includes("SYNTHETIC_DEFINITION_MUST_NOT_APPEAR"), false);
    }),
  );

  await t.test("bounds extension domain checks while retaining their complete census fingerprints", async () =>
    fixture(async () => {
      await db.exec(`
        CREATE SCHEMA domain_census;
        CREATE DOMAIN domain_census.method AS text CONSTRAINT allowed_method CHECK (VALUE IN ('GET','POST'));
        CREATE DOMAIN domain_census.unrelated AS text CONSTRAINT unrelated_check CHECK (VALUE <> '');
        ALTER EXTENSION plpgsql ADD DOMAIN domain_census.method;
        -- Preserve the real AUTO dependency while exercising the unowned
        -- constraint shape emitted by pg_net's CREATE DOMAIN installer.
        DELETE FROM pg_catalog.pg_depend WHERE classid='pg_catalog.pg_constraint'::regclass
          AND objid=(SELECT oid FROM pg_catalog.pg_constraint
            WHERE contypid='domain_census.method'::regtype AND conname='allowed_method')
          AND deptype='e';
      `);
      const associatedSql = execFileSync("python3", ["-c", `import importlib.util,sys
s=importlib.util.spec_from_file_location('domain_surface_fixture',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.NATIVE_RELATION_SURFACE_SQL)`,
        fileURLToPath(new URL("../../scripts/release/probe-empty-recovery-target.py", import.meta.url)),
      ], { encoding: "utf8" });
      const associated = JSON.parse(Object.values((await db.query(associatedSql)).rows[0])[0]);
      const bound = associated.filter((o) => o.schema === "domain_census");
      assert.equal(bound.length, 1);
      assert.equal(bound[0].catalog, "pg_constraint");
      assert.equal(bound[0].extension, "plpgsql");
      assert.ok(bound[0].identity.includes("allowed_method"));
      assert.equal(JSON.stringify(bound).includes("unrelated_check"), false);
      const before = await census();
      const original = before.namespaceObjects.find((o) => o.identity === bound[0].identity);
      assert.equal(original.directExtension, null);
      assert.equal(original.internalExtension, null);
      await db.exec("ALTER DOMAIN domain_census.method ADD CONSTRAINT added_check CHECK (VALUE <> 'POST')");
      const after = await census();
      assert.notDeepEqual(after, before);
      assert.ok(after.namespaceObjects.some((o) => o.catalog === "pg_constraint" && o.identity.includes("added_check")));
      assert.deepEqual(after.namespaceObjects.find((o) => o.identity === bound[0].identity), original);
    }),
  );

  await t.test(
    "global options and default privileges are detected without exposing option secrets",
    async () =>
      fixture(async () => {
        await db.exec(`
      CREATE SCHEMA globals_census;
      CREATE FOREIGN DATA WRAPPER census_fdw;
      CREATE SERVER census_server FOREIGN DATA WRAPPER census_fdw OPTIONS (password 'SYNTHETIC_SECRET_MUST_NOT_APPEAR');
      CREATE USER MAPPING FOR CURRENT_USER SERVER census_server OPTIONS (password 'SYNTHETIC_MAPPING_MUST_NOT_APPEAR');
      ALTER DEFAULT PRIVILEGES IN SCHEMA globals_census GRANT SELECT ON TABLES TO PUBLIC;
      CREATE TYPE globals_census.flavor AS ENUM ('synthetic');
      CREATE CAST (globals_census.flavor AS text) WITH INOUT;
    `);
        const before = await census();
        for (const catalog of [
          "pg_foreign_data_wrapper",
          "pg_foreign_server",
          "pg_user_mapping",
          "pg_default_acl",
        ]) {
          assert.ok(
            before.globalObjects.some((o) => o.catalog === catalog),
            catalog,
          );
        }
        assert.ok(
          before.globalObjects.some(
            (o) => o.catalog === "pg_cast" && o.identity.includes("globals_census.flavor"),
          ),
        );
        assert.equal(JSON.stringify(before).includes("SYNTHETIC_SECRET_MUST_NOT_APPEAR"), false);
        assert.equal(JSON.stringify(before).includes("SYNTHETIC_MAPPING_MUST_NOT_APPEAR"), false);
        await db.exec(
          "ALTER SERVER census_server OPTIONS (SET password 'DIFFERENT_SYNTHETIC_SECRET')",
        );
        const after = await census();
        const server = (c) => c.globalObjects.find((o) => o.catalog === "pg_foreign_server");
        assert.notEqual(
          server(before).details.catalogRowSha256,
          server(after).details.catalogRowSha256,
        );
      }),
  );

  await t.test(
    "global event triggers and publications do not disappear through namespace filters",
    async () =>
      fixture(async () => {
        await db.exec(`
      CREATE FUNCTION public.census_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
      CREATE EVENT TRIGGER census_event ON ddl_command_end EXECUTE FUNCTION public.census_ddl();
      CREATE PUBLICATION census_publication;
    `);
        const actual = await census();
        assert.ok(actual.globalObjects.some((o) => o.catalog === "pg_event_trigger"));
        assert.ok(actual.globalObjects.some((o) => o.catalog === "pg_publication"));
      }),
  );

  await t.test(
    "capture and metadata coverage retain pgsodium and pgmq as ordinary nonsystem schemas",
    async () => {
      const coverage = await PGlite.create();
      try {
        await coverage.exec(`
          CREATE SCHEMA pgsodium;
          CREATE SCHEMA pgmq;
          CREATE SCHEMA pgdata;
          CREATE SCHEMA fixture_extension_owned;
          ALTER EXTENSION plpgsql ADD SCHEMA fixture_extension_owned;
          CREATE TABLE pgsodium.synthetic_records(id integer, body text);
          CREATE TABLE pgmq.synthetic_records(id integer, body text);
          CREATE TABLE pgdata.synthetic_records(id integer, body text);
          INSERT INTO pgsodium.synthetic_records VALUES (1, 'SYNTHETIC_PRIVATE_ROW_NOT_METADATA');
        `);
        const [captureSql, metadataSql] = JSON.parse(
          execFileSync(
            "python3",
            [
              "-c",
              `import importlib.util,json,sys
def load(path):
 s=importlib.util.spec_from_file_location('coverage_sql_fixture',path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
print(json.dumps([load(sys.argv[1]).CATALOG_SQL,load(sys.argv[2]).SOURCE_SQL]))`,
              ...["managed-auth-recovery.py", "collect-empty-recovery-metadata.py"].map((name) =>
                fileURLToPath(new URL(`../../scripts/release/${name}`, import.meta.url)),
              ),
            ],
            { encoding: "utf8" },
          ),
        );
        for (const query of [captureSql, metadataSql]) {
          const results = await coverage.exec(query);
          const row = results
            .flatMap((r) => r.rows)
            .find((r) => Object.hasOwn(r, "jsonb_build_object"));
          const actual = JSON.parse(row.jsonb_build_object);
          if (query === metadataSql)
            assert.deepEqual(actual.extensionNamespaces, [
              { name: "fixture_extension_owned", extension: "plpgsql" },
            ]);
          for (const name of ["pgsodium", "pgmq", "pgdata"]) {
            assert.ok(
              actual.schemas.some((s) => s.name === name),
              name,
            );
            if (actual.tables)
              assert.ok(
                actual.tables.some((s) => s.schema === name),
                name,
              );
          }
          assert.equal(
            JSON.stringify(actual).includes("SYNTHETIC_PRIVATE_ROW_NOT_METADATA"),
            false,
          );
        }
      } finally {
        await coverage.close();
      }
    },
  );

  await t.test(
    "system-namespace custom objects alter the independent baseline fingerprint",
    async () =>
      fixture(async () => {
        const before = await census();
        await db.exec(
          "CREATE FUNCTION pg_catalog.census_unreviewed() RETURNS integer LANGUAGE sql AS $$ SELECT 3 $$",
        );
        const after = await census();
        assert.notEqual(
          before.structuralCatalogs.systemNamespaceObjectsSha256,
          after.structuralCatalogs.systemNamespaceObjectsSha256,
        );
        assert.equal(after.counts.unownedNamespaceObjects, 0);
      }),
  );
});
