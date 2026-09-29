import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assessRecovery } from "../../scripts/release/prepare-managed-recovery-candidate.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const names = [
  "Owners read agent evidence",
  "Users delete own library images",
  "Users read own library images",
  "Users upload to own library folder",
  "agent evidence owner read",
  "project_files_delete",
  "project_files_read",
  "project_files_update",
  "project_files_write",
];
const privileges = [
  "DELETE",
  "INSERT",
  "MAINTAIN",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
];

function fixture() {
  const functions = Array.from({ length: 23 }, (_, i) => {
    const ddl = `CREATE FUNCTION auth.synthetic_${i}() RETURNS integer LANGUAGE sql AS 'SELECT 1';`;
    return { schema: "auth", identity: `synthetic_${i}()`, ddl, sha256: hash(ddl) };
  });
  const triggers = Array.from({ length: 7 }, (_, i) => {
    const ddl = `CREATE TRIGGER synthetic_${i} BEFORE UPDATE ON storage.objects EXECUTE FUNCTION auth.synthetic_${i}();`;
    return {
      schema: "storage",
      relation: "objects",
      name: `synthetic_${i}`,
      ddl,
      sha256: hash(ddl),
    };
  });
  const policies = names.map((name) => {
    const ddl = `CREATE POLICY "${name}" ON storage.objects FOR SELECT TO authenticated USING (false);`;
    return { schema: "storage", relation: "objects", name, ddl, sha256: hash(ddl) };
  });
  const grant = (grantable) =>
    privileges.map((privilege) => ({
      grantor: "supabase_storage_admin",
      grantee: "supabase_storage_admin",
      privilege,
      grantable,
    }));
  const relationIds = [
    ...Array.from({ length: 28 }, (_, i) => `auth.synthetic_${i}`),
    "storage.buckets",
    "storage.objects",
    ...Array.from({ length: 6 }, (_, i) => `storage.synthetic_${i}`),
  ];
  const relation = (id, baseline = false) => {
    const different = ["storage.buckets", "storage.objects"].includes(id);
    const explicitAcl = different ? (baseline ? "baseline-acl" : "live-acl") : "same-acl";
    return {
      id,
      kind: "r",
      owner: id.startsWith("auth.") ? "supabase_auth_admin" : "supabase_storage_admin",
      rowSecurity: true,
      partitionParent: null,
      columnSha256: "same-column-hash",
      aclSha256: hash(explicitAcl),
      aclEntries: different ? grant(!baseline) : [],
    };
  };
  const liveRelations = relationIds.map((id) => relation(id));
  const targetRelations = [
    ...relationIds.map((id) => relation(id, true)),
    relation("storage.iceberg_namespaces", true),
    relation("storage.iceberg_tables", true),
  ];
  const extensions = [{ name: "synthetic-extension" }];
  const liveObjects = {
    relations: liveRelations,
    functions: functions.map((r) => ({
      id: `${r.schema}.${r.identity}`,
      definitionSha256: r.sha256,
    })),
    triggers: triggers.map((r) => ({
      id: `${r.schema}.${r.relation}.${r.name}`,
      definitionSha256: hash(r.ddl.slice(0, -1)),
    })),
    policies: policies.map((r) => ({ id: `${r.schema}.${r.relation}.${r.name}` })),
  };
  const exported = {
    exportSha256: "69dc2fa7010b495e2401140cf98bbf3e34783cc7959660a300752c52e5d7eb76",
    contents: {
      schemaVersion: 1,
      replayApproved: false,
      databaseVersion: "17.6",
      extensions,
      functions,
      triggers,
      policies,
      schemaAcls: [{}, {}],
      defaultAcls: Array(6).fill({}),
      columnAcls: [],
      relationAcls: liveRelations.map((r) => ({
        schema: r.id.split(".")[0],
        relation: r.id.split(".")[1],
        kind: r.kind,
        owner: r.owner,
        rowSecurity: r.rowSecurity,
        explicitAcl: ["storage.buckets", "storage.objects"].includes(r.id)
          ? "live-acl"
          : "same-acl",
      })),
    },
  };
  const live = {
    projectRef: "mfbycmbjygcfkrsuepxf",
    querySha256: "7c100ab324b6bedec6ce5483d9215ca818bf1f9e5e02ce17000fe607043a4452",
    catalog: {
      serverVersionNum: 170006,
      extensions,
      serviceMigrations: {},
      managedObjects: liveObjects,
    },
  };
  const probe = {
    kind: "synthetic-prepared-supabase-restore-target-probe",
    sourceCommit: "98c591619560728bf8915d390b8f6db6cf6142fa",
    imageTag: "public.ecr.aws/supabase/postgres:17.6.1.155",
    localImageId: "sha256:56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985",
    querySha256: live.querySha256,
    productionDataUsed: false,
    restorePerformed: false,
    approvedForRestore: false,
    catalog: {
      serverVersionNum: 170006,
      extensions,
      serviceMigrations: {},
      managedObjects: { ...liveObjects, relations: targetRelations, policies: [] },
    },
  };
  return { exported, live, probe };
}

test("private candidate lists only retained read policies and expected grant option deltas", () => {
  const result = assessRecovery(fixture());
  assert.equal(result.replayApproved, false);
  assert.equal(result.applied, false);
  assert.equal(result.realBackupRestored, false);
  assert.equal(result.policies.filter((policy) => policy.candidateSql).length, 3);
  assert.equal(
    result.policies.filter(
      (policy) => policy.sourceDisposition === "source-removed" && policy.candidateSql === null,
    ).length,
    6,
  );
  assert.equal(
    result.grantOptionDeltas.reduce((total, row) => total + row.privileges.length, 0),
    16,
  );
});

test("a new browser-role grant and a changed relation definition both stop candidate generation", () => {
  const browserGrant = fixture();
  browserGrant.live.catalog.managedObjects.relations.find(
    (r) => r.id === "storage.objects",
  ).aclEntries[0].grantee = "anon";
  assert.throws(() => assessRecovery(browserGrant), /unreviewed_acl_difference/u);

  const definitionDrift = fixture();
  definitionDrift.probe.catalog.managedObjects.relations.find(
    (r) => r.id === "auth.synthetic_0",
  ).columnSha256 = "unexpected";
  assert.throws(() => assessRecovery(definitionDrift), /relation_columnSha256_baseline_drift/u);
});
