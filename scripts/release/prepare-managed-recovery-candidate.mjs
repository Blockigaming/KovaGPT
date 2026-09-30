#!/usr/bin/env node
// Offline, private M17 comparison. Never connects to a database or applies SQL.
// The output is a candidate for review, not a restore script.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pinned = Object.freeze({
  exportFile: "042c587dc4c0751f6bb6481b004c502d9eb587acc0fe671342cf75adf77fd891",
  exportJsonb: "69dc2fa7010b495e2401140cf98bbf3e34783cc7959660a300752c52e5d7eb76",
  exportSql: "b7a21c8f214447bafefb15d3407785e8aec9a2688cef1156d285d72ef93d9369",
  liveFile: "153ddb164fa5474148f62df8f226218caf68afcbd6bd4be38de7a28a4f6a6210",
  catalogSql: "7c100ab324b6bedec6ce5483d9215ca818bf1f9e5e02ce17000fe607043a4452",
  probeZip: "99d98d2e8c15ed0fdd754fd5fae273e1b2bfcc0908396595bb34d0c665a5660d",
  probeCommit: "98c591619560728bf8915d390b8f6db6cf6142fa",
  probeImageId: "sha256:56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985",
});

const sourcePolicies = new Map([
  ["Owners read agent evidence", "source-retained-read"],
  ["Users read own library images", "source-retained-read"],
  ["project_files_read", "source-retained-read"],
  ["Users delete own library images", "source-removed"],
  ["Users upload to own library folder", "source-removed"],
  ["agent evidence owner read", "source-removed"],
  ["project_files_delete", "source-removed"],
  ["project_files_update", "source-removed"],
  ["project_files_write", "source-removed"],
]);
const sourceMigrations = new Map([
  [
    "20260902013000_storage_bucket_and_default_privilege_reconciliation.sql",
    "412b574ebc965c40857829cf4a01deb75d56a574a60bb7045f4170bf83ad753f",
  ],
  [
    "20260904200000_project_file_upload_integrity.sql",
    "75fbebf9f08d0573f648345360443f1c1c8ac22cee5e7c7cc25b66030eadb505",
  ],
  [
    "20260905033500_library_image_storage_quota.sql",
    "26187e62e670c1bc3fdaeb518cced84a7ea6fb35ba572ceaaecb7143f463890d",
  ],
  [
    "20260625135417_6425af75-f761-4dd6-9fcc-069b8c504829.sql",
    "799a37695678b5d9546221dc467b1d6d3118d028c89276dbf10168d726784a08",
  ],
]);

function requireThat(condition, code) {
  if (!condition) throw new Error(code);
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function ids(rows) {
  const mapped = new Map(rows.map((row) => [row.id, row]));
  requireThat(mapped.size === rows.length, "duplicate_object_identity");
  return mapped;
}
function compareDefinitions(exported, live, key, suffix = "") {
  const selected = live.managedObjects[key].filter((row) => /^(auth|storage)\./u.test(row.id));
  const expected = new Map(selected.map((row) => [row.id, row.definitionSha256]));
  requireThat(expected.size === exported.length, `${key}_count_mismatch`);
  for (const row of exported) {
    const id =
      key === "functions"
        ? `${row.schema}.${row.identity}`
        : `${row.schema}.${row.relation}.${row.name}`;
    requireThat(
      typeof row.ddl === "string" && sha256(row.ddl) === row.sha256,
      `${key}_export_ddl_hash_mismatch`,
    );
    requireThat(
      expected.get(id) === sha256(suffix ? row.ddl.slice(0, -1) : row.ddl),
      `${key}_live_definition_mismatch`,
    );
    expected.delete(id);
  }
  requireThat(expected.size === 0, `${key}_live_extra`);
}

export function assessRecovery({ exported, live, probe }) {
  const c = exported.contents;
  const production = live.catalog;
  const target = probe.catalog;
  requireThat(
    exported.exportSha256 === pinned.exportJsonb &&
      c.schemaVersion === 1 &&
      c.replayApproved === false,
    "export_identity_mismatch",
  );
  requireThat(
    live.projectRef === "mfbycmbjygcfkrsuepxf" && live.querySha256 === pinned.catalogSql,
    "live_binding_mismatch",
  );
  requireThat(
    probe.kind === "synthetic-prepared-supabase-restore-target-probe" &&
      probe.sourceCommit === pinned.probeCommit &&
      probe.imageTag === "public.ecr.aws/supabase/postgres:17.6.1.155" &&
      probe.localImageId === pinned.probeImageId &&
      probe.querySha256 === pinned.catalogSql &&
      probe.productionDataUsed === false &&
      probe.restorePerformed === false &&
      probe.approvedForRestore === false,
    "probe_identity_mismatch",
  );
  requireThat(
    c.databaseVersion === "17.6" &&
      production.serverVersionNum === 170006 &&
      target.serverVersionNum === 170006 &&
      same(c.extensions, production.extensions) &&
      same(production.extensions, target.extensions) &&
      same(production.serviceMigrations, target.serviceMigrations),
    "version_or_extension_drift",
  );
  requireThat(
    c.functions.length === 23 &&
      c.triggers.length === 7 &&
      c.policies.length === 9 &&
      c.relationAcls.length === 36 &&
      c.schemaAcls.length === 2 &&
      c.defaultAcls.length === 6 &&
      c.columnAcls.length === 0,
    "export_scope_drift",
  );
  compareDefinitions(c.functions, production, "functions");
  compareDefinitions(c.triggers, production, "triggers", ";");
  for (const key of ["functions", "triggers"]) {
    requireThat(
      same(production.managedObjects[key], target.managedObjects[key]),
      `${key}_baseline_drift`,
    );
  }

  const liveRelations = ids(
    production.managedObjects.relations.filter((r) => /^(auth|storage)\./u.test(r.id)),
  );
  const baselineRelations = ids(
    target.managedObjects.relations.filter((r) => /^(auth|storage)\./u.test(r.id)),
  );
  requireThat(liveRelations.size === 36 && baselineRelations.size === 38, "relation_scope_drift");
  const baselineOnly = [...baselineRelations.keys()].filter((id) => !liveRelations.has(id)).sort();
  requireThat(
    same(baselineOnly, ["storage.iceberg_namespaces", "storage.iceberg_tables"]),
    "unexpected_relation_presence",
  );
  const exportRelations = new Map(c.relationAcls.map((r) => [`${r.schema}.${r.relation}`, r]));
  requireThat(exportRelations.size === 36, "duplicate_export_relation");
  const grantOptionDeltas = [];
  for (const [id, a] of liveRelations) {
    const b = baselineRelations.get(id),
      row = exportRelations.get(id);
    requireThat(
      b &&
        row &&
        `${row.schema}.${row.relation}` === id &&
        row.kind === a.kind &&
        row.owner === a.owner &&
        row.rowSecurity === a.rowSecurity &&
        sha256(row.explicitAcl ?? "NULL") === a.aclSha256,
      "relation_export_drift",
    );
    for (const field of ["kind", "owner", "rowSecurity", "partitionParent", "columnSha256"]) {
      requireThat(same(a[field], b[field]), `relation_${field}_baseline_drift`);
    }
    if (a.aclSha256 === b.aclSha256) continue;
    requireThat(
      ["storage.buckets", "storage.objects"].includes(id),
      "unreviewed_relation_acl_drift",
    );
    const key = (g) => `${g.grantor}|${g.grantee}|${g.privilege}`;
    const existing = new Map(b.aclEntries.map((g) => [key(g), g]));
    requireThat(
      existing.size === b.aclEntries.length && a.aclEntries.length === b.aclEntries.length,
      "acl_entry_count_drift",
    );
    const changes = [];
    for (const grant of a.aclEntries) {
      const older = existing.get(key(grant));
      requireThat(
        older &&
          (grant.grantable === older.grantable ||
            (grant.grantee === "supabase_storage_admin" &&
              grant.grantor === "supabase_storage_admin" &&
              grant.grantable === true &&
              older.grantable === false)),
        "unreviewed_acl_difference",
      );
      if (grant.grantable !== older.grantable) changes.push(grant.privilege);
      existing.delete(key(grant));
    }
    requireThat(
      existing.size === 0 &&
        changes.length === 8 &&
        same(changes.slice().sort(), [
          "DELETE",
          "INSERT",
          "MAINTAIN",
          "REFERENCES",
          "SELECT",
          "TRIGGER",
          "TRUNCATE",
          "UPDATE",
        ]),
      "grant_option_delta_drift",
    );
    grantOptionDeltas.push({
      relation: id,
      grantor: "supabase_storage_admin",
      grantee: "supabase_storage_admin",
      privileges: changes,
      candidateSql: `GRANT ${changes.join(", ")} ON TABLE ${id} TO supabase_storage_admin WITH GRANT OPTION;`,
    });
  }
  requireThat(grantOptionDeltas.length === 2, "grant_option_scope_drift");

  const livePolicies = ids(
    production.managedObjects.policies.filter((r) => /^(auth|storage)\./u.test(r.id)),
  );
  const baselinePolicies = target.managedObjects.policies.filter((r) =>
    /^(auth|storage)\./u.test(r.id),
  );
  requireThat(
    baselinePolicies.length === 0 && livePolicies.size === 9 && sourcePolicies.size === 9,
    "policy_baseline_drift",
  );
  const policies = c.policies.map((row) => {
    const id = `${row.schema}.${row.relation}.${row.name}`;
    requireThat(
      id.startsWith("storage.objects.") &&
        livePolicies.has(id) &&
        typeof row.ddl === "string" &&
        sha256(row.ddl) === row.sha256 &&
        sourcePolicies.has(row.name),
      "policy_export_drift",
    );
    livePolicies.delete(id);
    return {
      identity: id,
      sourceDisposition: sourcePolicies.get(row.name),
      ownerDecisionRequired: true,
      candidateSql: sourcePolicies.get(row.name) === "source-retained-read" ? row.ddl : null,
    };
  });
  requireThat(
    livePolicies.size === 0 && policies.filter((p) => p.candidateSql).length === 3,
    "policy_count_drift",
  );
  return {
    kind: "m17-private-replay-candidate",
    replayApproved: false,
    applied: false,
    realBackupRestored: false,
    exportJsonbSha256: pinned.exportJsonb,
    exportFileSha256: pinned.exportFile,
    liveCatalogFileSha256: pinned.liveFile,
    probeZipSha256: pinned.probeZip,
    targetBaselineOnlyRelations: baselineOnly,
    relationCreationStatements: [],
    grantOptionDeltas,
    policies,
    remainingChecks: [
      "full target schema/function/default/column ACL comparison and grantor replay",
      "relation constraint/index/dependency definitions and the two target-only relations",
      "all nine policy decisions and isolated policy behavior",
      "private provider/key custody, Storage bytes, real-backup restore and application checks",
    ],
  };
}

function main() {
  const args = process.argv.slice(2);
  requireThat(
    args.length === 8 &&
      args.every((x, i) =>
        i % 2 === 0 ? ["--export", "--live", "--probe-zip", "--output"].includes(x) : isAbsolute(x),
      ),
    "usage_absolute_paths_required",
  );
  const opts = Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [args[i * 2], args[i * 2 + 1]]),
  );
  requireThat(Object.keys(opts).length === 4, "duplicate_argument");
  for (const [name, expected] of [
    ["--export", pinned.exportFile],
    ["--live", pinned.liveFile],
    ["--probe-zip", pinned.probeZip],
  ]) {
    requireThat(sha256(readFileSync(opts[name])) === expected, `${name}_file_hash_mismatch`);
  }
  for (const [name, expected] of [
    ["managed-schema-recovery-ddl.sql", pinned.exportSql],
    ["isolated-restore-target-catalog.sql", pinned.catalogSql],
  ]) {
    requireThat(
      sha256(readFileSync(join(root, "scripts/release", name))) === expected,
      "source_query_changed",
    );
  }
  for (const [name, expected] of sourceMigrations) {
    requireThat(
      sha256(readFileSync(join(root, "supabase/migrations", name))) === expected,
      "policy_source_changed",
    );
  }
  const probePath = opts["--probe-zip"];
  requireThat(
    execFileSync("unzip", ["-Z1", probePath], { encoding: "utf8" }).trim() ===
      "local-restore-target-probe.json",
    "probe_members_changed",
  );
  const probe = JSON.parse(
    execFileSync("unzip", ["-p", probePath, "local-restore-target-probe.json"], {
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
    }),
  );
  const candidate = assessRecovery({
    exported: JSON.parse(readFileSync(opts["--export"], "utf8")),
    live: JSON.parse(readFileSync(opts["--live"], "utf8")),
    probe,
  });
  const output = opts["--output"];
  requireThat(!existsSync(output), "output_already_exists");
  const parent = realpathSync(dirname(output));
  requireThat(
    (statSync(parent).mode & 0o077) === 0 &&
      (relative(root, parent).startsWith("..") || isAbsolute(relative(root, parent))),
    "private_output_directory_required",
  );
  writeFileSync(output, `${JSON.stringify(candidate, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      candidateSha256: sha256(readFileSync(output)),
      retainedPolicyCandidates: 3,
      blockedPolicyCandidates: 6,
      grantOptionDeltas: 16,
      replayApproved: false,
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`managed_recovery_candidate: ${error.message}`);
    process.exitCode = 1;
  }
}
