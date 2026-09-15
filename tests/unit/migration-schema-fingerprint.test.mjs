import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintMigrationSchemaSnapshot,
} from "../../scripts/release/migration-schema-fingerprint.mjs";

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    scope: {
      proofId: "proof-20260823092107",
      objects: ["public.scheduled_tasks", "public.kova_claim_scheduled_tasks"],
    },
    categories: {
      schema: [{ table: "scheduled_tasks", column: "lease_owner", nullable: true }],
      acl: [{ object: "scheduled_tasks", role: "authenticated", privilege: "SELECT" }],
      rls: [{ table: "scheduled_tasks", policy: "owner_select", command: "SELECT" }],
      function: [
        {
          signature: "kova_claim_scheduled_tasks(integer,text)",
          argumentTypes: ["integer", "text"],
          securityDefiner: true,
          definitionSha256: "a".repeat(64),
        },
      ],
    },
    ...overrides,
  };
}

test("fingerprints are stable across object-key and top-level row ordering", () => {
  const first = snapshot({
    categories: {
      schema: [
        { table: "scheduled_tasks", column: "lease_owner", nullable: true },
        { table: "scheduled_tasks", column: "lease_until", nullable: true },
      ],
      acl: [
        { object: "scheduled_tasks", role: "authenticated", privilege: "SELECT" },
        { role: "service_role", privilege: "UPDATE", object: "scheduled_tasks" },
      ],
      rls: [{ table: "scheduled_tasks", policy: "owner_select", command: "SELECT" }],
      function: [],
    },
  });
  const second = snapshot({
    categories: {
      schema: [
        { nullable: true, column: "lease_until", table: "scheduled_tasks" },
        { nullable: true, column: "lease_owner", table: "scheduled_tasks" },
      ],
      acl: [
        { privilege: "UPDATE", object: "scheduled_tasks", role: "service_role" },
        { privilege: "SELECT", role: "authenticated", object: "scheduled_tasks" },
      ],
      rls: [{ command: "SELECT", policy: "owner_select", table: "scheduled_tasks" }],
      function: [],
    },
  });

  assert.deepEqual(
    fingerprintMigrationSchemaSnapshot(first),
    fingerprintMigrationSchemaSnapshot(second),
  );
});

test("fingerprints preserve nested sequence semantics such as function argument order", () => {
  const first = fingerprintMigrationSchemaSnapshot(snapshot());
  const changed = snapshot();
  changed.categories.function[0].argumentTypes = ["text", "integer"];
  const second = fingerprintMigrationSchemaSnapshot(changed);

  assert.notEqual(first.functionSha256, second.functionSha256);
  assert.equal(first.schemaSha256, second.schemaSha256);
  assert.equal(first.aclSha256, second.aclSha256);
  assert.equal(first.rlsSha256, second.rlsSha256);
});

test("fingerprints bind every category to the declared proof scope", () => {
  const first = fingerprintMigrationSchemaSnapshot(snapshot());
  const second = fingerprintMigrationSchemaSnapshot(
    snapshot({
      scope: {
        proofId: "proof-20260823092450",
        objects: ["public.scheduled_tasks", "public.kova_claim_scheduled_tasks"],
      },
    }),
  );

  for (const field of [
    "schemaSha256",
    "aclSha256",
    "rlsSha256",
    "functionSha256",
  ]) {
    assert.notEqual(first[field], second[field]);
  }
});

test("rejects incomplete category snapshots instead of hashing missing evidence", () => {
  const invalid = snapshot();
  delete invalid.categories.rls;
  assert.throws(
    () => fingerprintMigrationSchemaSnapshot(invalid),
    /migration_schema_snapshot_rows_invalid/u,
  );
});
