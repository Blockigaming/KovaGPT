import { RehearsalError } from "./auth-migration-rehearsal.server.mjs";

const LEGACY_CONSTRAINT_QUERY_MARKER = "FROM information_schema.table_constraints AS tc";

export const AUTH_CONSTRAINT_CATALOG_SQL = `
SELECT
  source_table.relname AS table_name,
  CASE constraint_record.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'f' THEN 'FOREIGN KEY'
  END AS constraint_type,
  constraint_record.conname AS constraint_name,
  source_column.attname AS column_name,
  target_namespace.nspname AS foreign_table_schema,
  target_table.relname AS foreign_table_name,
  target_column.attname AS foreign_column_name,
  source_key.ordinality AS ordinal_position,
  constraint_record.confdeltype AS foreign_delete_action
FROM pg_catalog.pg_constraint AS constraint_record
JOIN pg_catalog.pg_class AS source_table
  ON source_table.oid = constraint_record.conrelid
JOIN pg_catalog.pg_namespace AS source_namespace
  ON source_namespace.oid = source_table.relnamespace
JOIN LATERAL pg_catalog.unnest(constraint_record.conkey)
  WITH ORDINALITY AS source_key(attnum, ordinality)
  ON TRUE
JOIN pg_catalog.pg_attribute AS source_column
  ON source_column.attrelid = source_table.oid
 AND source_column.attnum = source_key.attnum
LEFT JOIN pg_catalog.pg_class AS target_table
  ON target_table.oid = constraint_record.confrelid
LEFT JOIN pg_catalog.pg_namespace AS target_namespace
  ON target_namespace.oid = target_table.relnamespace
LEFT JOIN LATERAL pg_catalog.unnest(constraint_record.confkey)
  WITH ORDINALITY AS target_key(attnum, ordinality)
  ON target_key.ordinality = source_key.ordinality
LEFT JOIN pg_catalog.pg_attribute AS target_column
  ON target_column.attrelid = target_table.oid
 AND target_column.attnum = target_key.attnum
WHERE source_namespace.nspname = 'auth'
  AND source_table.relname IN ('users', 'identities')
  AND constraint_record.contype IN ('p', 'u', 'f')
ORDER BY source_table.relname, constraint_record.conname, source_key.ordinality`;

function groupConstraintColumns(rows, tableName, constraintType) {
  const grouped = new Map();
  for (const row of rows) {
    if (row.table_name !== tableName || row.constraint_type !== constraintType) continue;
    const columns = grouped.get(row.constraint_name) ?? [];
    columns.push(row.column_name);
    grouped.set(row.constraint_name, columns);
  }
  return grouped;
}

function groupForeignKeyMappings(rows, tableName) {
  const grouped = new Map();
  for (const row of rows) {
    if (row.table_name !== tableName || row.constraint_type !== "FOREIGN KEY") continue;
    const mappings = grouped.get(row.constraint_name) ?? [];
    mappings.push({
      columnName: row.column_name,
      foreignTableSchema: row.foreign_table_schema,
      foreignTableName: row.foreign_table_name,
      foreignColumnName: row.foreign_column_name,
      foreignDeleteAction: row.foreign_delete_action,
    });
    grouped.set(row.constraint_name, mappings);
  }
  return grouped;
}

function sameColumnSet(actual, expected) {
  return actual.length === expected.length && expected.every((column) => actual.includes(column));
}

function isExactIdentityUserForeignKey(mappings) {
  if (mappings.length !== 1) return false;
  const [mapping] = mappings;
  return (
    mapping.columnName === "user_id" &&
    mapping.foreignTableSchema === "auth" &&
    mapping.foreignTableName === "users" &&
    mapping.foreignColumnName === "id" &&
    mapping.foreignDeleteAction === "c"
  );
}

export function validateAuthoritativeAuthConstraints(rows) {
  if (!Array.isArray(rows)) throw new RehearsalError("schema_contract_mismatch", 503);

  const usersPrimaryKeys = groupConstraintColumns(rows, "users", "PRIMARY KEY");
  const identitiesPrimaryKeys = groupConstraintColumns(rows, "identities", "PRIMARY KEY");
  const identityUniqueConstraints = groupConstraintColumns(rows, "identities", "UNIQUE");
  const identityForeignKeys = groupForeignKeyMappings(rows, "identities");

  const hasUsersPk = [...usersPrimaryKeys.values()].some((columns) => sameColumnSet(columns, ["id"]));
  const hasIdentitiesPk = [...identitiesPrimaryKeys.values()].some((columns) =>
    sameColumnSet(columns, ["id"]),
  );
  const hasUniqueProviderSubject = [...identityUniqueConstraints.values()].some((columns) =>
    sameColumnSet(columns, ["provider", "provider_id"]),
  );
  const hasIdentityUserFk = [...identityForeignKeys.values()].some((mappings) =>
    isExactIdentityUserForeignKey(mappings),
  );

  if (!hasUsersPk || !hasIdentitiesPk || !hasUniqueProviderSubject || !hasIdentityUserFk) {
    throw new RehearsalError("schema_contract_mismatch", 503);
  }
  return rows;
}

export function createAuthRehearsalDatabaseAdapter(client) {
  if (!client || typeof client.query !== "function") {
    throw new RehearsalError("invalid_configuration", 503);
  }

  return {
    async query(sql, values = []) {
      if (typeof sql === "string" && sql.includes(LEGACY_CONSTRAINT_QUERY_MARKER)) {
        const result = await client.query(AUTH_CONSTRAINT_CATALOG_SQL);
        validateAuthoritativeAuthConstraints(result.rows);
        return result;
      }
      return client.query(sql, values);
    },
  };
}
