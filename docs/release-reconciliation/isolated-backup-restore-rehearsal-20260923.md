# Supabase recovery package and isolated restore rehearsal

Status on 2026-09-23: **M17 and M18 remain open.** This document describes evidence and an approval-ready recovery procedure. No restore, database write, project creation, or branch creation was performed.

## Retained inputs and limits

| Input                    | Verified observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Limit                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encrypted logical export | GitHub Actions run `35346103522`, source `8518628335eea524da6b7cb1fb951178441de95f`. Artifact `10545769998` is a ZIP with SHA-256 `9e744a8ac16534df53ea2f071ecbf122846a1325eff15df5bbab31b020374eaf`; contained GPG file is 151,336 bytes with SHA-256 `5576f064954d8deb1d09faa8838a9600d4906e2b4dc8a1e51a48a6ced8aff6af`. The ZIP digest matches GitHub artifact `10545769998` metadata and an independent calculation; the GPG digest and byte count match the run's `backup-evidence.json`. | Archive has not been decrypted or restored here. Artifact expires 2026-09-25 12:43:46 UTC; owner previously downloaded separately. Verify the durable owner copy before relying on it.                                                                                                                                                                                                                        |
| Storage payload          | Earlier read-only inventory found two buckets and one object. A 695,738-byte payload was recovered from a retained repository bundle, and its digest/one-part ETag matched the registered object metadata.                                                                                                                                                                                                                                                                                     | Not a live Storage HTTP export and not inside the encrypted SQL export. Confirm the retained payload and inventory match a fresh pre-cutover capture.                                                                                                                                                                                                                                                         |
| Managed schema           | Read-only `REPEATABLE READ`, `READ ONLY` [repeatable catalog query](../../scripts/release/managed-schema-recovery-inventory.sql) and [catalog observation](managed-schema-recovery-catalog-20260923.json): 28 Auth relations including one sequence; eight Storage relations, no sequences; nine live `storage.objects` policies, four Storage noninternal triggers, zero Auth noninternal triggers, zero unexpected managed relation or sequence owners, and nine installed extensions.       | The nine policy definitions are captured as metadata. Source migrations define two `auth.users` deletion triggers, `reject_unsettled_customer_auth_deletion` and `guard_organization_owner_auth_deletion`. Neither is present live; do not claim either is backed up or replay either during recovery without a separate reconciliation decision. This is not a complete managed-schema DDL/privilege export. |
| Cloud configuration      | Supabase project `mfbycmbjygcfkrsuepxf`, PostgreSQL `17.6.1.155`, region `us-west-2`, ACTIVE_HEALTHY, zero deployed Edge Functions.                                                                                                                                                                                                                                                                                                                                                            | Dashboard provider settings require sign-in and are unverified; no JWT, database, service-role, OAuth, SMTP, or backup passphrase value was read or recorded.                                                                                                                                                                                                                                                 |

The backup workflow expressly records `storageObjectBytesBackedUp: false`, `authStorageManagedSchemaCustomizationBackupComplete: false`, and `restoreExercised: false`. Its successful upload cannot flip these facts. See [production-backup-export.md](production-backup-export.md).

### Private integrity and passphrase precheck for the retained September 18 copy

The source-only [backup inspector](../../scripts/release/inspect-encrypted-recovery-backup.py) can verify the retained ZIP, GPG passphrase, six internal archive members, manifest and five SQL payload hashes **before a restore is approved**. Run it only in a private, trusted environment where the retained ZIP and protected `KOVA_PRODUCTION_BACKUP_PASSPHRASE` are already available. It does not connect to production or an isolated database, and writes no decrypted SQL file. The result is a private integrity receipt, not a schema or restore proof. Do not run this command in a public CI job or upload the receipt or decrypted bytes to a PR.

```bash
umask 077
: "${KOVA_RECOVERY_ZIP:?private retained September 18 ZIP path required}"
: "${KOVA_PRODUCTION_BACKUP_PASSPHRASE:?protected secret required}"
private_receipt_dir="$(mktemp -d)"
python3 scripts/release/inspect-encrypted-recovery-backup.py \
  --zip "$KOVA_RECOVERY_ZIP" \
  --expected-zip-sha256 9e744a8ac16534df53ea2f071ecbf122846a1325eff15df5bbab31b020374eaf \
  --expected-source-sha 8518628335eea524da6b7cb1fb951178441de95f \
  --private-receipt "$private_receipt_dir/backup-inspection.json"
```

Keep that directory out of the repository and preserve the receipt privately. This check does not decide whether the dump's SQL can run inside one transaction, whether managed schema customizations or Storage bytes are recoverable, or whether Auth and app behavior works. Those still require the separate approved target, restore, and checks below. A different backup needs a separately pinned ZIP digest and source SHA; never substitute one by changing a constant in place.

### Data-free target version probe

On September 26 the read-only production project metadata still reported Supabase Postgres `17.6.1.155`. The source-pinned CLI `2.111.0` defaults to local image `17.6.1.156`, so the earlier isolated source replay is **not an exact image-version match** for the retained backup. The [separate pull-request workflow](../../.github/workflows/probe-isolated-restore-target.yml) starts an empty disposable local `.155` image, runs the [same read-only aggregate query](../../scripts/release/isolated-restore-target-catalog.sql) used for a fresh production managed-schema count/extension observation, records its actual local image ID, and shuts it down. It has no production credentials, backup bytes, passphrase, or restore command. Even if the probe passes, inspect differences in Auth/Storage/Realtime objects and extensions, verify the image provenance and network isolation independently, and obtain separate approval before exposing any retained backup to that target. The probe cannot accept M17 or M18.

The catalog marks `Users upload to own library folder` and `Users delete own library images` as **live-only**: migration `20260905033500_library_image_storage_quota.sql:35-36` drops both because browser Storage writes bypass the server quota-reservation contract. They remain in the nine-policy live snapshot as evidence, but their replay is blocked until an explicit source/live reconciliation decision. The two absent Auth deletion triggers are source-only. This known-difference inventory is not exhaustive.

The catalog query was executed with the Supabase connector explicitly targeting project `mfbycmbjygcfkrsuepxf`; the JSON's project reference records that invocation. The SQL output by itself does not authenticate its target. Recheck the connector target whenever repeating it.

## M17 acceptance inputs still needed

1. **Managed schemas:** capture complete live custom Auth/Storage DDL, policies, owners, default/table/function privileges, triggers, dependent functions, Storage bucket settings, and relevant installed extension versions. Compare with a version-matched clean Supabase baseline and the 98-version production history. Confirm the nine captured policies, both live-only browser Storage policies, both source-only Auth triggers, and any further source/live differences explicitly. Verify a reviewed export can recreate the customizations in an isolated environment.
2. **Provider configuration:** inventory actual Auth email/password, Google OAuth, callback/allowed redirect URLs, email templates, SMTP, MFA and security settings, API/Data API, Realtime, Storage limits and policies, and external webhook configuration. Record sanitized _presence and destination_ only; preserve private settings in an access-controlled recovery vault.
3. **Key custody and recoverability:** privately verify the owner has the GPG passphrase, database credentials, JWT/signing configuration, publishable/secret API keys, Google OAuth and SMTP credentials, and the Azure/runtime secret references required by `src/lib/config/diagnostics.server.ts`. Test access/decryption in the approved isolated recovery environment; never paste secrets into GitHub, chat, a PR, or an artifact manifest. Plan key rotation and token/session invalidation for a new target.
4. **Payload:** bind the retained Storage object bytes and bucket access settings to the recovery inventory, and validate a restored read/download under an isolated test identity. Repeat inventory before cutover if production has changed.

No single SQL dump can prove dashboard-only configuration or Storage object bytes. The Supabase [platform-to-self-hosted restore guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform) documents these omissions, PostgreSQL-version compatibility, and the need to restore roles, schema, and data separately. Supabase's [managed schema permissions guide](https://supabase.com/docs/guides/platform/permissions) identifies the expected `supabase_auth_admin` and `supabase_storage_admin` owners.

## Proposed M18 operation — separate authorization required

Use a newly approved **isolated, version-matched PostgreSQL 17 Supabase test stack**, with private networking, outbound SMTP/SMS/OAuth/webhook delivery blocked, and no production DNS/connection string or Azure app attached. Select and pin its image/service versions and host before approval; a blank generic PostgreSQL image is insufficient because Auth/Storage managed schemas and extensions must match. Use the owner's already retained encrypted ZIP and password manager; do not transmit either in chat. A Supabase branch is **not** an equivalent full restore of this backup: it starts by applying project migrations, and may have existing managed-schema differences.

The org's read-only Supabase cost quote on 2026-09-23 is **$0.01344 per branch-hour** (two hours `$0.02688`, before other usage); the new-project quote is `$0/month` but does not guarantee a free slot, usage, or a suitable isolated target. No branch/project was created. A local test stack has no Supabase cloud charge but needs a version-matched, approved image and local compute; verify its image digest and any runner-minute/hosting costs at authorization time. Do not start a clock-billed target merely to discover missing prerequisites.

### 1. Verify and decrypt the retained archive in an isolated private workspace

Only after the specific restore is approved, run with `set +x` and `umask 077`. Set `KOVA_RECOVERY_ZIP` to the owner's private ZIP path; supply `KOVA_PRODUCTION_BACKUP_PASSPHRASE` through an approved protected secret mechanism, never command history or a visible prompt. Use an encrypted scratch volume or an ephemeral workspace with restricted access. The commands below prepare files only and do not contact a database:

```bash
set -euo pipefail
set +x
umask 077
: "${KOVA_RECOVERY_ZIP:?set the owner-retained encrypted ZIP path}"
: "${KOVA_PRODUCTION_BACKUP_PASSPHRASE:?load from protected secret storage}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s  %s\n' 9e744a8ac16534df53ea2f071ecbf122846a1325eff15df5bbab31b020374eaf "$KOVA_RECOVERY_ZIP" | sha256sum --check --strict
unzip -p "$KOVA_RECOVERY_ZIP" backup-evidence.json > "$work/backup-evidence.json"
unzip -p "$KOVA_RECOVERY_ZIP" kova-production-backup.tar.gpg > "$work/archive.gpg"
printf '%s  %s\n' 5576f064954d8deb1d09faa8838a9600d4906e2b4dc8a1e51a48a6ced8aff6af "$work/archive.gpg" | sha256sum --check --strict
printf '%s' "$KOVA_PRODUCTION_BACKUP_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 --decrypt --output "$work/plain.tar" "$work/archive.gpg"
unset KOVA_PRODUCTION_BACKUP_PASSPHRASE
mkdir "$work/plain"
KOVA_RECOVERY_WORK="$work" python3 - <<'PY'
import os, pathlib, tarfile
base = pathlib.Path(os.environ['KOVA_RECOVERY_WORK'])
expected = {'roles.sql','schema.sql','data.sql','history_schema.sql','history_data.sql','manifest.json'}
with tarfile.open(base / 'plain.tar', 'r:') as archive:
    members = archive.getmembers()
    if len(members) != len(expected) or {m.name for m in members} != expected or not all(m.isfile() for m in members):
        raise SystemExit('unexpected, duplicate, or non-regular backup member')
    for member in members:
        with archive.extractfile(member) as src, (base / 'plain' / member.name).open('xb') as dst:
            while chunk := src.read(1024 * 1024):
                dst.write(chunk)
PY
KOVA_RECOVERY_WORK="$work" node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.KOVA_RECOVERY_WORK;
const receipt = JSON.parse(readFileSync(join(root, "backup-evidence.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "plain/manifest.json"), "utf8"));
const projectRef = "mfbycmbjygcfkrsuepxf";
const sourceSha = "8518628335eea524da6b7cb1fb951178441de95f";
const expected = ["roles.sql", "schema.sql", "data.sql", "history_schema.sql", "history_data.sql"];
if (receipt.projectRef !== projectRef || receipt.sourceSha !== sourceSha ||
    receipt.encryptedArchiveSha256 !== "5576f064954d8deb1d09faa8838a9600d4906e2b4dc8a1e51a48a6ced8aff6af" ||
    manifest.projectRef !== projectRef || manifest.sourceSha !== sourceSha ||
    manifest.schemaVersion !== 1 || manifest.files?.length !== expected.length ||
    manifest.includesStorageObjectBytes !== false ||
    manifest.includesAuthStorageManagedSchemaCustomizations !== false) {
  throw new Error("backup receipt or scope mismatch");
}
for (const name of expected) {
  const row = manifest.files.find((file) => file.name === name);
  const bytes = readFileSync(join(root, "plain", name));
  if (!row || row.bytes !== bytes.length ||
      row.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
    throw new Error(`backup file integrity mismatch: ${name}`);
  }
}
console.log("Encrypted artifact and five internal SQL payloads match the pinned backup manifest.");
NODE
```

### 2. Approve and verify the actual target, then restore in one transaction

Record target image digest/version, private address, PostgreSQL cluster `system_identifier`, database name/port, planned resource lifetime, exact cost cap, operator, backup hash, and destruction plan. A separate owner approval must identify **that** target and **that** operation. The operator must independently verify the destination is a fresh isolated PostgreSQL 17 Supabase stack with matching Auth/Storage versions, expected extensions, empty application and auth data, and no route to production or outbound provider services. Reject any production project URI, existing customer rows, incompatible managed table version, or inability to disable outbound effects. Do not substitute a tunnel whose local hostname points at production. The cluster identifier and IP must be obtained independently from the approved newly provisioned target before loading the restore URL; do not derive the expected values from the URL under test.

Use a passwordless approved PostgreSQL URI and an owner-provided private `PGPASSFILE` (regular file owned by the operator, mode `0600` or stricter). Set `APPROVED_ISOLATED_HOST`, `APPROVED_ISOLATED_DBNAME`, `APPROVED_ISOLATED_PORT`, `APPROVED_ISOLATED_SERVER_IP`, and `APPROVED_ISOLATED_SYSTEM_IDENTIFIER` from the approved target record. The exact URI and passfile stay outside this repository. The executable [read-only preflight](../../scripts/release/verify-isolated-restore-target.mjs) rejects the production project ref, local tunnels, a URI password or unapproved connection overrides; pins the approved server IP; checks the database/cluster identity, PG17, nine extension versions and schemas, and zero Auth users/identities/sessions, Storage buckets/objects, and application relations; then writes a private fingerprint. It requires `pg_control_system()` permission; if unavailable, stop and obtain a separately reviewed target attestation. The observed address/cluster identity must match the independent target record.

Before a restore, review the decrypted SQL for transaction control, nontransactional commands, unexpected psql meta-commands, and conflicts with roles or managed objects already in the clean stack. The `supabase db dump --role-only` output has not been inspected because the archive remains encrypted here, so transaction-safe role replay is **unproven**. PostgreSQL's `psql --single-transaction` protects this order only if every file can execute inside one transaction and does not contain its own `BEGIN`/`COMMIT`/`ROLLBACK`; if not, stop and revise the plan for approval. The following command is an early stop check, not proof of transaction safety:

```bash
scan_status=0
rg -q -i '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|CREATE[[:space:]]+DATABASE|CREATE[[:space:]]+TABLESPACE|ALTER[[:space:]]+SYSTEM|VACUUM|REINDEX)([[:space:];]|$)|^[[:space:]]*\\(connect|c|gexec|i|include|!)([[:space:]]|$)' "$work/plain/"*.sql || scan_status=$?
if [ "$scan_status" -ne 1 ]; then
  echo 'Stop: SQL requires transaction-compatibility review' >&2
  exit 1
fi
```

After those checks, run the preflight **immediately before** the approved restore, in the same private shell. The preflight writes only aggregate/metadata observations and no customer rows:

```bash
: "${APPROVED_ISOLATED_PG17_DATABASE_URL:?bind the approved passwordless URI}"
: "${PGPASSFILE:?bind the approved private pgpass file}"
: "${APPROVED_ISOLATED_SERVER_IP:?bind the independently approved target IP}"
export APPROVED_ISOLATED_PREFLIGHT_OUTPUT="$work/isolated-target-preflight.json"
node scripts/release/verify-isolated-restore-target.mjs
export PGHOSTADDR="$APPROVED_ISOLATED_SERVER_IP"
psql --no-psqlrc --no-password --single-transaction --set ON_ERROR_STOP=1 \
  --file "$work/plain/roles.sql" \
  --file "$work/plain/schema.sql" \
  --file "$work/plain/history_schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$work/plain/data.sql" \
  --file "$work/plain/history_data.sql" \
  --command 'SET session_replication_role = origin' \
  --dbname "$APPROVED_ISOLATED_PG17_DATABASE_URL"
```

The `APPROVED_ISOLATED_PG17_DATABASE_URL` value is intentionally absent from this repository: it must be bound to an independently inspected **new** target immediately before execution. Roles, application schema and migration-history schema precede data; triggering is suspended only for data import. `ON_ERROR_STOP` plus `--single-transaction` aborts on SQL error if the inspected files meet the transaction conditions above. Never rerun into a partially restored target. Save the preflight fingerprint, approval record, and redacted restore output together in private recovery evidence.

### 3. Validate and stop

Against the isolated target only, compare aggregate counts and schema fingerprints with the backup manifest and source snapshot; exercise Auth login and token/session semantics with isolated test identities; confirm Storage bucket settings, one retained object's SHA-256, access policies, and previous application revision compatibility without external requests. Verify all nine live policy semantics after a separately reviewed managed-schema replay. Confirm no real email, OAuth callback, Stripe, AI request, scheduled task, or webhook occurred. Record target image digest, timestamps, commands with secrets redacted, export/restore hashes, count differences, health checks, RTO, and cleanup proof.

**Stop** if backup/passphrase retrieval, data integrity, managed-schema alignment, provider configuration, target isolation, target emptiness, compatibility, or cost cap cannot be established. Delete or quarantine the isolated restored copy according to the approved data retention plan. The September 18 snapshot proves only recovery of that snapshot, not the current production state; take a fresh verified backup before cutover.

M18 closes only after an **actual** approved isolated restore, application recovery exercise, and independently reviewed evidence. This plan and local source tests confer no restore credit.
