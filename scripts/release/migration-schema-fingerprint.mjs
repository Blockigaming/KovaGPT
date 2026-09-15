import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CATEGORY_FIELDS = {
  schema: "schemaSha256",
  acl: "aclSha256",
  rls: "rlsSha256",
  function: "functionSha256",
};

function stableObject(value) {
  if (Array.isArray(value)) return value.map((item) => stableObject(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])]),
  );
}

function canonicalRows(rows) {
  if (!Array.isArray(rows)) throw new Error("migration_schema_snapshot_rows_invalid");
  return rows
    .map((row) => JSON.stringify(stableObject(row)))
    .sort()
    .map((row) => JSON.parse(row));
}

function hashCategory(scope, rows) {
  const payload = JSON.stringify({ scope: stableObject(scope), rows: canonicalRows(rows) });
  return createHash("sha256").update(payload).digest("hex");
}

export function fingerprintMigrationSchemaSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("migration_schema_snapshot_invalid");
  }
  if (snapshot.schemaVersion !== 1) {
    throw new Error("migration_schema_snapshot_version_invalid");
  }
  if (!snapshot.scope || typeof snapshot.scope !== "object" || Array.isArray(snapshot.scope)) {
    throw new Error("migration_schema_snapshot_scope_invalid");
  }
  if (!snapshot.categories || typeof snapshot.categories !== "object") {
    throw new Error("migration_schema_snapshot_categories_invalid");
  }

  const fingerprint = {};
  for (const [category, field] of Object.entries(CATEGORY_FIELDS)) {
    fingerprint[field] = hashCategory(snapshot.scope, snapshot.categories[category]);
  }
  return fingerprint;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.env.KOVA_MIGRATION_SCHEMA_SNAPSHOT_FILE;
  if (!input) throw new Error("KOVA_MIGRATION_SCHEMA_SNAPSHOT_FILE_required");
  const snapshot = JSON.parse(readFileSync(resolve(input), "utf8"));
  process.stdout.write(
    `${JSON.stringify(fingerprintMigrationSchemaSnapshot(snapshot), null, 2)}\n`,
  );
}
