# Production logical backup export

This workflow exists because the current KovaGPT production Supabase project is on a plan without platform backup/PITR evidence, while release rollback requires an independently retained recovery artifact.

`Backup Supabase production only` is deliberately manual. It may run only from `main`, only after `BACKUP_ONLY` confirmation and an exact selected SHA, and only in the protected `production` GitHub environment. It performs a read-only logical export and does not restore, deploy, run migration repair, alter production data, change Azure, change DNS, or shift traffic.

## Required protected secrets

Create these as GitHub **production environment secrets**, never repository files, workflow inputs, PR comments, issue comments, or chat messages:

- `KOVA_PRODUCTION_DATABASE_URL`: the exact production Supabase Postgres connection URI for project `mfbycmbjygcfkrsuepxf`. A Session pooler URI is acceptable and is preferable when direct IPv6 connectivity is unavailable. The workflow rejects a URI whose host/user identity does not bind to that project.
- `KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926`: a newly generated random passphrase of at least 32 characters for fresh backups. Save it in an owner-controlled password manager **before** setting this new environment secret; verify the saved value can be retrieved privately. Store it separately from the encrypted backup artifact. The older `KOVA_PRODUCTION_BACKUP_PASSPHRASE` secret must remain intact: replacing it does not decrypt the September 18 backup, whose original passphrase has not been recovered. The new workflow maps the new secret into its existing runtime variable without printing it.

Do not reset the database password merely to satisfy this workflow unless a separately reviewed credential-rotation decision requires it.

## What the workflow exports

The workflow follows Supabase's documented CLI logical-backup pattern with CLI version `2.111.0`. It downloads the exact Linux amd64 release archive over HTTPS, verifies the release asset against the pinned SHA-256 `31ee8a152e9c8c8eddae072c6bc7c9119748a96c8cdaf21a6d31c9ce7e62cc18`, verifies every archive path is relative and traversal-free, requires exactly one root `supabase` entry, stream-extracts only that entry into a newly created regular file, verifies its ELF magic, and installs it only into the ephemeral runner. Additional checksum-covered upstream metadata files are ignored rather than extracted.

It then exports:

1. custom roles (`--role-only`);
2. application schema;
3. application data (`--data-only --use-copy`), excluding current vector-storage helper tables called out by Supabase migration guidance;
4. `supabase_migrations` schema;
5. `supabase_migrations` data.

The plaintext files exist only in the ephemeral hosted runner. They are checksummed into an internal manifest, packed, encrypted with GPG symmetric AES-256, and deleted before artifact upload. GitHub receives only the encrypted archive plus a key-free evidence JSON containing the encrypted archive hash/size and explicit limitation flags.

Never commit plaintext SQL backup files to this repository.

## What this does **not** prove or back up

This logical database export does not include Supabase Storage object bytes. Storage metadata in the database is not a substitute for the files themselves. KovaGPT's Storage object bytes must be downloaded separately and stored durably outside Supabase.

Supabase CLI's ordinary database dump intentionally excludes managed schemas. If KovaGPT has custom changes to the managed `auth` and `storage` schemas, those changes require separate reviewed evidence/export as described by Supabase's migration guidance; do not claim this workflow captures them merely because application schema/data dumps succeed.

It also does not reproduce dashboard-only configuration such as Auth provider settings, API credentials, Edge Function deployment state, Realtime configuration, external webhooks, or other provider configuration. Those remain configuration-recovery evidence gates.

A successful backup run is not a restore rehearsal. Final rollback evidence still requires a controlled restore/recovery exercise into an isolated target, validation of schema/data/auth/storage behavior, and proof that the previous application revision remains compatible. Never restore this archive into production as an exploratory test.

## Owner sequence

1. Review and merge the backup workflow through the normal source process.
2. Confirm the existing protected production database URI secret is available. Generate and save the new backup passphrase privately, verify private retrieval, then add `KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926` as a separate protected `production` environment secret. Do not modify the older backup passphrase secret.
3. Run **Backup Supabase production only** on the exact reviewed `main` SHA with `confirmation=BACKUP_ONLY` and `source_sha=<same SHA>`.
4. Download the resulting encrypted artifact before its 7-day Actions retention expires and store it in a durable private location separate from Supabase.
5. Run the private inspector against this **new** encrypted artifact using the saved new passphrase and its own observed ZIP hash and source SHA. The September 18 pins do not apply to the new artifact. Keep the inspection receipt private; a successful export alone does not establish decryptability.
6. Record the run ID, exact SHA, encrypted archive SHA-256 and durable storage location in release evidence. Do not record the database URI or encryption passphrase.
7. Separately capture Storage object bytes, managed `auth`/`storage` customizations, and configuration-recovery evidence.
8. Perform a later isolated restore rehearsal before claiming rollback readiness.

The workflow's success means only that a filtered, encrypted logical export was produced. It must never be described as PITR, a physical Supabase backup, a full project clone, or completed disaster recovery.
