import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/backup-supabase-production.yml", import.meta.url),
  "utf8",
);
const docs = readFileSync(
  new URL("../../docs/release-reconciliation/production-backup-export.md", import.meta.url),
  "utf8",
);

test("production backup is manual, exact-main and protected-environment gated", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /inputs\.confirmation == 'BACKUP_ONLY'/u);
  assert.match(workflow, /inputs\.source_sha == github\.sha/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment:\n      name: production/u);
  assert.doesNotMatch(workflow, /schedule:|push:/u);
});

test("backup pins the production project and checksum-pinned Supabase CLI bytes", () => {
  assert.match(workflow, /KOVA_PRODUCTION_PROJECT_REF: mfbycmbjygcfkrsuepxf/u);
  assert.match(workflow, /version="2\.111\.0"/u);
  assert.match(
    workflow,
    /https:\/\/github\.com\/supabase\/cli\/releases\/download\/v\$\{version\}\/supabase_\$\{version\}_linux_amd64\.tar\.gz/u,
  );
  assert.match(
    workflow,
    /expected_sha256="31ee8a152e9c8c8eddae072c6bc7c9119748a96c8cdaf21a6d31c9ce7e62cc18"/u,
  );
  assert.match(workflow, /sha256sum --check --strict/u);
  assert.doesNotMatch(workflow, /uses:\s+supabase\/setup-cli/u);
  assert.match(workflow, /production_project_identity_mismatch/u);
});

test("backup exports roles schema data and migration history without restore commands", () => {
  assert.match(workflow, /roles\.sql" --role-only/u);
  assert.match(workflow, /schema\.sql"/u);
  assert.match(workflow, /data\.sql" --use-copy --data-only/u);
  assert.match(workflow, /history_schema\.sql" --schema supabase_migrations/u);
  assert.match(workflow, /history_data\.sql" --use-copy --data-only --schema supabase_migrations/u);
  assert.doesNotMatch(
    workflow,
    /supabase db (?:push|reset|pull)|psql .*--file|az containerapp update|az deployment|wrangler deploy/u,
  );
});

test("workflow never uploads plaintext SQL and explicitly preserves remaining backup gaps", () => {
  const upload = workflow.slice(workflow.indexOf("- name: Upload encrypted backup evidence only"));
  assert.match(upload, /kova-production-backup\.tar\.gpg/u);
  assert.match(upload, /backup-evidence\.json/u);
  assert.doesNotMatch(
    upload,
    /roles\.sql|schema\.sql|data\.sql|history_schema\.sql|history_data\.sql/u,
  );
  assert.match(workflow, /plaintextUploaded: false/u);
  assert.match(workflow, /storageObjectBytesBackedUp: false/u);
  assert.match(workflow, /authStorageManagedSchemaCustomizationBackupComplete: false/u);
  assert.match(workflow, /restoreExercised: false/u);
});

test("credentials are required as secrets, masked, and not accepted as workflow inputs", () => {
  assert.match(workflow, /secrets\.KOVA_PRODUCTION_DATABASE_URL/u);
  assert.match(workflow, /secrets\.KOVA_PRODUCTION_BACKUP_PASSPHRASE/u);
  assert.match(workflow, /::add-mask::\$KOVA_PRODUCTION_DATABASE_URL/u);
  assert.match(workflow, /::add-mask::\$KOVA_PRODUCTION_BACKUP_PASSPHRASE/u);
  const inputs = workflow.slice(
    workflow.indexOf("workflow_dispatch:"),
    workflow.indexOf("permissions:"),
  );
  assert.doesNotMatch(inputs, /password|database_url|passphrase/iu);
});

test("documentation does not misrepresent a logical dump as complete disaster recovery", () => {
  assert.match(docs, /does not include Supabase Storage object bytes/iu);
  assert.match(docs, /custom changes to the managed `auth` and `storage` schemas/iu);
  assert.match(docs, /restore rehearsal/iu);
  assert.match(docs, /never commit plaintext SQL/iu);
});
