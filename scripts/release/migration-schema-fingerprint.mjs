import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CATEGORY_FIELDS = {
  schema: "schemaSha256",
  acl: "aclSha256",
  rls: "rlsSha256",
  function: "functionSha256",
};

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableObject(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if ((!Array.isArray(value) && !plainRecord(value)) || ancestors.has(value)) {
    throw new Error("migration_schema_snapshot_json_invalid");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) {
        throw new Error("migration_schema_snapshot_json_invalid");
      }
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error("migration_schema_snapshot_json_invalid");
        }
        return stableObject(descriptor.value, ancestors);
      });
    }
    const keys = Object.keys(value).sort();
    if (Reflect.ownKeys(value).length !== keys.length) {
      throw new Error("migration_schema_snapshot_json_invalid");
    }
    return Object.fromEntries(
      keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!("value" in descriptor)) throw new Error("migration_schema_snapshot_json_invalid");
        return [key, stableObject(descriptor.value, ancestors)];
      }),
    );
  } finally {
    ancestors.delete(value);
  }
}

function canonicalRows(rows) {
  if (
    !Array.isArray(rows) ||
    rows.some((row) => !plainRecord(row) || Object.keys(row).length === 0)
  ) {
    throw new Error("migration_schema_snapshot_rows_invalid");
  }
  return stableObject(rows)
    .map((row) => JSON.stringify(row))
    .sort()
    .map((row) => JSON.parse(row));
}

function hashCategory(scope, rows) {
  const payload = JSON.stringify({ scope: stableObject(scope), rows: canonicalRows(rows) });
  return createHash("sha256").update(payload).digest("hex");
}

export function fingerprintMigrationSchemaSnapshot(snapshot) {
  if (!plainRecord(snapshot)) {
    throw new Error("migration_schema_snapshot_invalid");
  }
  if (snapshot.schemaVersion !== 1) {
    throw new Error("migration_schema_snapshot_version_invalid");
  }
  const scope = snapshot.scope;
  if (
    !plainRecord(scope) ||
    typeof scope.proofId !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{2,127}$/u.test(scope.proofId) ||
    !Array.isArray(scope.objects) ||
    scope.objects.length === 0 ||
    scope.objects.some(
      (name) => typeof name !== "string" || !name.trim() || name !== name.trim(),
    ) ||
    new Set(scope.objects).size !== scope.objects.length
  ) {
    throw new Error("migration_schema_snapshot_scope_invalid");
  }
  if (!plainRecord(snapshot.categories)) {
    throw new Error("migration_schema_snapshot_categories_invalid");
  }

  const fingerprint = {};
  for (const [category, field] of Object.entries(CATEGORY_FIELDS)) {
    fingerprint[field] = hashCategory(snapshot.scope, snapshot.categories[category]);
  }
  return fingerprint;
}

export function digestMigrationSchemaSnapshot(snapshot) {
  fingerprintMigrationSchemaSnapshot(snapshot);
  return createHash("sha256")
    .update(JSON.stringify(stableObject(snapshot)))
    .digest("hex");
}

export function digestMigrationSchemaScope(snapshot) {
  fingerprintMigrationSchemaSnapshot(snapshot);
  return createHash("sha256")
    .update(JSON.stringify(stableObject(snapshot.scope)))
    .digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.env.KOVA_MIGRATION_SCHEMA_SNAPSHOT_FILE;
  if (!input) throw new Error("KOVA_MIGRATION_SCHEMA_SNAPSHOT_FILE_required");
  const snapshot = JSON.parse(readFileSync(resolve(input), "utf8"));
  process.stdout.write(
    `${JSON.stringify(fingerprintMigrationSchemaSnapshot(snapshot), null, 2)}\n`,
  );
}
