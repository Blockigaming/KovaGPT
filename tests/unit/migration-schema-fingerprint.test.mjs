import assert from "node:assert/strict";
import test from "node:test";

import {
  digestMigrationSchemaScope,
  digestMigrationSchemaSnapshot,
  fingerprintMigrationSchemaSnapshot,
} from "../../scripts/release/migration-schema-fingerprint.mjs";

const fingerprint = fingerprintMigrationSchemaSnapshot;
const fields = ["schemaSha256", "aclSha256", "rlsSha256", "functionSha256"];

function snapshot() {
  return {
    schemaVersion: 1,
    scope: {
      proofId: "proof-20260823092107",
      objects: ["public.scheduled_tasks", "public.claim_due_scheduled_tasks(text,integer,integer)"],
    },
    categories: {
      schema: [{ table: "scheduled_tasks", column: "worker_id", nullable: true }],
      acl: [{ object: "scheduled_tasks", role: "authenticated", privilege: "SELECT" }],
      rls: [{ table: "scheduled_tasks", policy: "owner_select", command: "SELECT" }],
      function: [
        {
          signature: "claim_due_scheduled_tasks(text,integer,integer)",
          argumentTypes: ["text", "integer", "integer"],
          securityDefiner: true,
          definitionSha256: "a".repeat(64),
        },
      ],
    },
  };
}

test("fingerprints are stable across object-key and top-level row ordering", () => {
  const first = snapshot();
  first.categories.schema.push({ table: "scheduled_tasks", column: "lease_expires_at" });
  const second = structuredClone(first);
  second.categories.schema.reverse();
  second.categories.schema[1] = { nullable: true, column: "worker_id", table: "scheduled_tasks" };
  assert.deepEqual(fingerprint(first), fingerprint(second));
});

test("snapshot digests canonicalize object keys while preserving exact row order", () => {
  const first = snapshot();
  first.categories.schema.push({ table: "scheduled_tasks", column: "lease_expires_at" });
  const reorderedKeys = structuredClone(first);
  reorderedKeys.categories.schema[0] = {
    nullable: true,
    column: "worker_id",
    table: "scheduled_tasks",
  };
  assert.equal(digestMigrationSchemaSnapshot(first), digestMigrationSchemaSnapshot(reorderedKeys));
  reorderedKeys.categories.schema.reverse();
  assert.notEqual(
    digestMigrationSchemaSnapshot(first),
    digestMigrationSchemaSnapshot(reorderedKeys),
  );
});

test("fingerprints preserve nested sequence semantics such as argument order", () => {
  const first = fingerprint(snapshot());
  const changed = snapshot();
  changed.categories.function[0].argumentTypes = ["integer", "text", "integer"];
  const second = fingerprint(changed);
  assert.notEqual(first.functionSha256, second.functionSha256);
  for (const field of fields.slice(0, 3)) assert.equal(first[field], second[field]);
});

test("fingerprints bind every category to the declared proof scope", () => {
  const first = fingerprint(snapshot());
  const firstScope = digestMigrationSchemaScope(snapshot());
  const changed = snapshot();
  changed.scope.proofId = "proof-20260823092450";
  const second = fingerprint(changed);
  for (const field of fields) assert.notEqual(first[field], second[field]);
  assert.notEqual(firstScope, digestMigrationSchemaScope(changed));
});

test("rejects a missing category rather than treating it as empty", () => {
  const invalid = snapshot();
  delete invalid.categories.rls;
  assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_rows_invalid/u);
});

for (const scope of [{}, { proofId: "x" }, { objects: [] }, { proofId: "proof-a", objects: [] }]) {
  test(`rejects incomplete proof scopes: ${JSON.stringify(scope)}`, () => {
    const invalid = { ...snapshot(), scope };
    assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_scope_invalid/u);
  });
}

for (const row of [null, 1, "row", [], {}]) {
  test(`rejects malformed catalog rows: ${JSON.stringify(row)}`, () => {
    const invalid = snapshot();
    invalid.categories.schema = [row];
    assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_rows_invalid/u);
  });
}

for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol("x"), new Date(0)]) {
  test(`rejects lossy or non-JSON catalog values: ${String(value)}`, () => {
    const invalid = snapshot();
    invalid.categories.schema[0].value = value;
    assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_json_invalid/u);
  });
}

test("rejects sparse arrays that JSON would silently convert to null", () => {
  const invalid = snapshot();
  invalid.categories.function[0].argumentTypes = Array(2);
  assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_json_invalid/u);
});

test("rejects circular input with a controlled evidence error", () => {
  const invalid = snapshot();
  invalid.categories.schema[0].cycle = invalid.categories.schema[0];
  assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_json_invalid/u);
});

test("preserves explicit null values without accepting non-finite JSON numbers", () => {
  const valid = snapshot();
  valid.categories.schema[0].default = null;
  assert.match(fingerprint(valid).schemaSha256, /^[a-f0-9]{64}$/u);
  const invalid = JSON.parse(JSON.stringify(valid).replace('"default":null', '"default":1e400'));
  assert.throws(() => fingerprint(invalid), /migration_schema_snapshot_json_invalid/u);
});

test("preserves duplicate row multiplicity instead of hiding extra grants", () => {
  const first = fingerprint(snapshot());
  const changed = snapshot();
  changed.categories.acl.push({ ...changed.categories.acl[0] });
  assert.notEqual(first.aclSha256, fingerprint(changed).aclSha256);
});

test("does not normalize whitespace or string-literal semantics in policies", () => {
  const first = snapshot();
  first.categories.rls[0].expression = "label = 'a  b'";
  const second = structuredClone(first);
  second.categories.rls[0].expression = "label = 'a b'";
  assert.notEqual(fingerprint(first).rlsSha256, fingerprint(second).rlsSha256);
});

test("permits explicit empty categories for a separately reviewed absence proof", () => {
  const value = snapshot();
  for (const category of Object.keys(value.categories)) value.categories[category] = [];
  assert.equal(Object.keys(fingerprint(value)).length, 4);
});
