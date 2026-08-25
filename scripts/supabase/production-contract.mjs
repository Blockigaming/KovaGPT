import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const migrationsDir = "supabase/migrations";
const requiredTables = [
  "chat_message_versions",
  "chat_branches",
  "chat_pinned_files",
  "chat_custom_rules",
];
const requiredScripts = [
  "scripts/supabase/reconcile-migrations-local.sh",
  "scripts/supabase/backup-production.sh",
  "scripts/supabase/verify-backup.sh",
  "scripts/supabase/restore-rehearsal.sh",
];

export function validateSupabaseProductionContract() {
  assert.equal(existsSync(migrationsDir), true, "supabase/migrations is missing");
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
    .sort();
  assert.ok(files.length > 0, "no migrations found");
  const versions = files.map((name) => name.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length, "duplicate migration versions exist");

  const combined = files.map((name) => readFileSync(`${migrationsDir}/${name}`, "utf8")).join("\n");
  for (const table of requiredTables) {
    assert.match(
      combined,
      new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${table}`, "iu"),
      `${table} migration is missing`,
    );
    assert.match(
      combined,
      new RegExp(
        `alter\\s+table\\s+(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`,
        "iu",
      ),
      `${table} RLS is not enabled`,
    );
  }

  const twoUser = readFileSync("scripts/release/rls-two-user.mjs", "utf8");
  assert.match(
    twoUser,
    /for \(const label of \["A", "B"\]\)/u,
    "two-user verifier must create two independent principals",
  );
  assert.match(twoUser, /headersA/u, "two-user verifier must authenticate the owner principal");
  assert.match(twoUser, /headersB/u, "two-user verifier must authenticate a second principal");
  assert.match(
    twoUser,
    /rls_cross_user_(?:read|update|delete)_allowed/u,
    "two-user verifier must prove cross-user isolation",
  );

  for (const script of requiredScripts) {
    assert.equal(existsSync(script), true, `${script} is missing`);
    const source = readFileSync(script, "utf8");
    assert.doesNotMatch(
      source,
      /migration repair --status/u,
      `${script} must not mutate migration history automatically`,
    );
  }

  const reconcile = readFileSync(requiredScripts[0], "utf8");
  assert.match(
    reconcile,
    /migration fetch --linked/u,
    "migration reconciliation must fetch remote history",
  );
  assert.match(reconcile, /npx --no-install supabase/u, "Supabase CLI must be repository locked");
  const backup = readFileSync(requiredScripts[1], "utf8");
  assert.match(
    backup,
    /storageObjectsIncluded:\s*false/u,
    "backup must disclose excluded Storage objects",
  );
  assert.match(backup, /CHECKSUMS\.sha256/u, "backup must be checksummed");
  const restore = readFileSync(requiredScripts[3], "utf8");
  assert.match(restore, /KOVA_SUPABASE_RESTORE_TARGET_IS_DISPOSABLE/u);
  assert.match(restore, /refusing to restore into the production project/u);
  assert.match(restore, /relrowsecurity/u, "restore rehearsal must verify RLS");

  return {
    migrations: files.length,
    uniqueVersions: true,
    requiredTables,
    twoUserIsolationHarness: true,
    backupAndRestore: true,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateSupabaseProductionContract();
  console.log(
    `KOVA_SUPABASE_PRODUCTION_CONTRACT=PASS migrations=${result.migrations} backupRestore=true twoUser=true`,
  );
}
