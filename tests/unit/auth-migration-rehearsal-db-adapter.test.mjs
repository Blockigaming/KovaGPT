import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_CONSTRAINT_CATALOG_SQL,
  createAuthRehearsalDatabaseAdapter,
  validateAuthoritativeAuthConstraints,
} from "../../src/lib/auth-migration-rehearsal-db-adapter.server.mjs";
import { RehearsalError } from "../../src/lib/auth-migration-rehearsal.server.mjs";

function authoritativeRows(overrides = {}) {
  const deleteAction = overrides.deleteAction ?? "c";
  const uniqueColumns = overrides.uniqueColumns ?? ["provider_id", "provider"];
  return [
    {
      table_name: "users",
      constraint_type: "PRIMARY KEY",
      constraint_name: "users_pkey",
      column_name: "id",
      foreign_table_schema: null,
      foreign_table_name: null,
      foreign_column_name: null,
      ordinal_position: 1,
      foreign_delete_action: " ",
    },
    {
      table_name: "identities",
      constraint_type: "PRIMARY KEY",
      constraint_name: "identities_pkey",
      column_name: "id",
      foreign_table_schema: null,
      foreign_table_name: null,
      foreign_column_name: null,
      ordinal_position: 1,
      foreign_delete_action: " ",
    },
    ...uniqueColumns.map((column_name, index) => ({
      table_name: "identities",
      constraint_type: "UNIQUE",
      constraint_name: "identities_provider_id_provider_unique",
      column_name,
      foreign_table_schema: null,
      foreign_table_name: null,
      foreign_column_name: null,
      ordinal_position: index + 1,
      foreign_delete_action: " ",
    })),
    {
      table_name: "identities",
      constraint_type: "FOREIGN KEY",
      constraint_name: "identities_user_id_fkey",
      column_name: "user_id",
      foreign_table_schema: overrides.foreignSchema ?? "auth",
      foreign_table_name: overrides.foreignTable ?? "users",
      foreign_column_name: overrides.foreignColumn ?? "id",
      ordinal_position: 1,
      foreign_delete_action: deleteAction,
    },
  ];
}

function expectSchemaMismatch(callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof RehearsalError);
    assert.equal(error.code, "schema_contract_mismatch");
    assert.equal(error.status, 503);
    return true;
  });
}

test("authoritative constraint contract accepts modern Supabase FK and order-independent provider uniqueness", () => {
  assert.equal(validateAuthoritativeAuthConstraints(authoritativeRows()).length, 5);
  assert.doesNotThrow(() =>
    validateAuthoritativeAuthConstraints(
      authoritativeRows({ uniqueColumns: ["provider", "provider_id"] }),
    ),
  );
});

test("authoritative constraint contract requires exact auth.users(id) FK with ON DELETE CASCADE", () => {
  for (const rows of [
    authoritativeRows({ deleteAction: "a" }),
    authoritativeRows({ foreignSchema: "public" }),
    authoritativeRows({ foreignTable: "other_users" }),
    authoritativeRows({ foreignColumn: "other_id" }),
  ]) {
    expectSchemaMismatch(() => validateAuthoritativeAuthConstraints(rows));
  }
});

test("authoritative constraint contract rejects a composite FK that only contains the required mapping", () => {
  const rows = authoritativeRows();
  rows.push({
    ...rows.find((row) => row.constraint_name === "identities_user_id_fkey"),
    column_name: "provider",
    foreign_column_name: "email",
    ordinal_position: 2,
  });
  expectSchemaMismatch(() => validateAuthoritativeAuthConstraints(rows));
});

test("authoritative constraint contract rejects split provider uniqueness", () => {
  const rows = authoritativeRows().filter(
    (row) => row.constraint_name !== "identities_provider_id_provider_unique",
  );
  rows.push(
    {
      table_name: "identities",
      constraint_type: "UNIQUE",
      constraint_name: "identities_provider_key",
      column_name: "provider",
      ordinal_position: 1,
    },
    {
      table_name: "identities",
      constraint_type: "UNIQUE",
      constraint_name: "identities_provider_id_key",
      column_name: "provider_id",
      ordinal_position: 1,
    },
  );
  expectSchemaMismatch(() => validateAuthoritativeAuthConstraints(rows));
});

test("database adapter replaces only the fragile information-schema constraint query", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === AUTH_CONSTRAINT_CATALOG_SQL) return { rows: authoritativeRows() };
      return { rows: [{ passthrough: true }] };
    },
  };
  const adapter = createAuthRehearsalDatabaseAdapter(client);

  const legacySql = `SELECT tc.table_name FROM information_schema.table_constraints AS tc`;
  const replaced = await adapter.query(legacySql);
  assert.equal(replaced.rows[0].table_name, "users");
  assert.equal(calls[0].sql, AUTH_CONSTRAINT_CATALOG_SQL);

  const passthrough = await adapter.query("SELECT 1", [123]);
  assert.deepEqual(passthrough.rows, [{ passthrough: true }]);
  assert.deepEqual(calls[1], { sql: "SELECT 1", values: [123] });
});

test("catalog query is read-only and does not rely on constraint_column_usage", () => {
  assert.match(AUTH_CONSTRAINT_CATALOG_SQL, /pg_catalog\.pg_constraint/);
  assert.match(AUTH_CONSTRAINT_CATALOG_SQL, /pg_catalog\.pg_attribute/);
  assert.doesNotMatch(AUTH_CONSTRAINT_CATALOG_SQL, /constraint_column_usage/);
  assert.doesNotMatch(
    AUTH_CONSTRAINT_CATALOG_SQL,
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i,
  );
});
