# Production Auth recovery operator: database capture and isolated qualification

This delta is based on source `db8ca50c78be9bd72399673621a9c5386a3e8a39` (tree `48cb5889dc7f60df7414201564b8cf049ae12161`). Integrating it creates a new source identity. No workflow, capture, restore, migration, deployment, scheduler or email has been executed by this preparation.

Production is Supabase project `mfbycmbjygcfkrsuepxf`, region `us-west-2`. The current independently observed database metadata is `ACTIVE_HEALTHY`, PostgreSQL build `17.6.1.155`, engine 17, GA. That observation is reused; this operator does not repeat the project catalog. The compatible image tag is `public.ecr.aws/supabase/postgres:17.6.1.155`; a tag is not an immutable-image receipt. Actual execution must resolve and independently record its `public.ecr.aws/supabase/postgres@sha256:…` RepoDigest. PostgreSQL SQL-level version is 17.6 (`server_version_num=170006`); that alone does not prove the provider build.

## Existing protected route and exact new inputs

The existing `.github/workflows/backup-supabase-production.yml` filters managed schema definitions and explicitly does not exercise restore. Keep its historical artifacts and passphrase versions. Do not dispatch it as the complete recovery gate.

The added `.github/workflows/capture-managed-auth-production.yml` is a capture-only route: current `main`, exact reviewed `source_sha == github.sha`, protected `production` environment, `CAPTURE_ONLY`, `approved_database_build=17.6.1.155`, one concurrent execution, 30-minute job timeout. It reuses only these already named protected secrets:

| Protected secret | Runtime input | Purpose |
|---|---|---|
| `KOVA_PRODUCTION_DATABASE_URL` | same name | Production read-only export connection; exact project direct host or port-5432 session pooler, verified TLS |
| `KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926` | `KOVA_PRODUCTION_BACKUP_PASSPHRASE` | AES-256 GPG envelope; keep this original version under existing custody |

The workflow must be integrated into reviewed main before dispatch. It requires existing PostgreSQL-17 clients, GPG, GNU `timeout` and a trusted public CA bundle on the runner and fails before DB reads when unavailable. No runner/client qualification is claimed here. It creates no cloud resource or credential. The code refuses transaction-pooler port 6543 and connection-string option injection. It does not print a connection string, key, raw account row, password hash or database diagnostic.

Exact capture command executed by that workflow:

```sh
timeout --signal=TERM --kill-after=10s 26m python3 scripts/release/managed-auth-recovery.py capture --execute --output "$RUNNER_TEMP/managed-auth-capture"
```

Output contains only `managed-auth-backup.tar.gpg` and `capture-receipt.json`; retention is seven days. Copy the ciphertext and passphrase-custody reference to the existing approved durable backup location before retention expires. Do not put the passphrase in the artifact, a workflow input, command arguments or this receipt. Only the existing protected secret is injected. The GPG round trip must actually succeed on that execution host; a mocked fixture is not evidence of working encryption.

## Database coverage and stop conditions

Capture holds an exported repeatable-read, read-only snapshot while `pg_dump` captures the whole accessible database without schema/table exclusions or owner/ACL removal. Private ciphertext includes full custom dump, full and Auth/Storage/Realtime schema definitions, role attributes/memberships/settings, extensions, publications, large-object ownership/ACL/content hashes, ordered TOC and per-table row count/content proofs. Auth users retain original UUIDs and every captured field, including hosted password hashes, identities, MFA, session, reset/recovery data. No user transformation or import into owned Auth occurs during backup.

Tables in `public`, `kova_private`, `auth`, `storage`, migration history and other non-system namespaces must be covered, including materialized-view contents. Foreign tables or any table without verifiable dump data stop capture; it never declares complete coverage by silently ignoring inaccessible or extension-owned relation data. If managed privileges or extension-owned tables prevent full capture, obtain a supported provider full-database snapshot/export route or an explicitly reviewed supplemental capture; do not weaken the gate. Existing app preferences and encrypted records remain unchanged.

All row proofs and schema/role details remain inside ciphertext. Sequences are taken from the captured dump's `setval` statements, restored and checked exactly; sequence allocation itself is not MVCC, so a sequence high-water mark is not represented as a transactionally frozen row. Data/schema snapshot consistency, high-water values and the actual capture interval are distinct evidence.

The operator uses a cooperative 25-minute total deadline, checked around local hashing, archive scans/copies, row-proof processing, command waits and successful receipts. Each child wait consumes the remaining budget and is at most 15 minutes. These checks cannot preempt a single stalled filesystem/library call. The capture workflow therefore also uses a hard outer GNU `timeout` supervisor at 26 minutes (TERM, then KILL after 10 seconds) inside its 30-minute job limit. The private restore host must provide the same hard outer supervisor before execution; Python deadline checks alone do not establish a hard wall-clock guarantee. There is also a kernel-enforced 4-GiB per-file cap, bounded file-backed stdout, private temporary directories and fixed redacted failures. The exporting session is kept alive between dumps and its idle timeout exceeds the total budget. A failed capture removes partial output. These small-production bounds stop rather than truncate or claim recovery.

## Isolated restore route and private inputs

Restore runs only on an existing independently approved private operator/target. No target has been provisioned or qualified by this delta. Use the existing `verify-isolated-restore-target.mjs` guard through the added wrapper, with the current encrypted capture's extension list; the historical September catalog cannot qualify a target.

Before any decryption, Monitoring must establish and independently review network controls that deny all production routes and all Internet egress from the restore target and operator, stop every consumer/service, and disable cron launching. This includes HTTP/SMTP/Resend, webhooks, Edge Functions, background workers, `kova-one-recovery-dispatch`, subscriptions and jobs. Application dispatcher flags alone do not disable independent consumers. Document actual network/host control evidence; setting JSON booleans does not create isolation. Do not resolve isolation by changing production or destroying the existing target.

The source target is always forbidden for restore. Localhost/tunnels, production project identifiers, Supabase poolers, embedded passwords and unapproved URI parameters are rejected. A pinned private host/IP/port/database/cluster system identifier, private owned 0600 `PGPASSFILE`, verified TLS and PostgreSQL-17 target are required. The target must contain no app or account/Storage user state, match the exact current Auth/Storage/Realtime schema, role privileges and extensions, and use the compatible exact provider build/image baseline. A bare Postgres image is not automatically a compatible initialized Supabase baseline.

Required restore environment, supplied privately by the approved operator rather than pasted into chat:

| Input | Required binding |
|---|---|
| `KOVA_AUTH_RECOVERY_CONFIRMATION` | `RESTORE_ISOLATED` |
| `KOVA_AUTH_BACKUP_ENCRYPTED_SHA256` | Exact ciphertext hash from capture receipt |
| `KOVA_APPROVED_BACKUP_SOURCE_SHA` | Exact integrated source SHA from capture |
| `KOVA_PRODUCTION_BACKUP_PASSPHRASE` | Existing protected original passphrase version |
| `APPROVED_ISOLATED_PG17_DATABASE_URL` | Passwordless isolated URI, `sslmode=verify-full`, explicit `sslrootcert` path |
| `PGPASSFILE` | Owned regular 0600 file; preserve original custody; no `PGPASSWORD` |
| `APPROVED_ISOLATED_HOST`, `APPROVED_ISOLATED_DBNAME`, `APPROVED_ISOLATED_PORT` | Independently approved exact destination |
| `APPROVED_ISOLATED_SERVER_IP`, `APPROVED_ISOLATED_SYSTEM_IDENTIFIER` | Independently pinned target address/cluster |
| `KOVA_AUTH_RESTORE_ATTESTATION`, `KOVA_AUTH_RESTORE_ATTESTATION_SHA256` | Private file and exact hash of independently reviewed isolation/image evidence |

Attestation schema (replace placeholders with actual reviewed nonsecret metadata; do not copy as an approval):

```json
{
  "format": 1,
  "sourceProject": "mfbycmbjygcfkrsuepxf",
  "imageTag": "public.ecr.aws/supabase/postgres:17.6.1.155",
  "actualImageRepoDigest": "public.ecr.aws/supabase/postgres@sha256:<64-hex-observed-digest>",
  "postgresBuild": "17.6.1.155",
  "host": "<approved-private-host>",
  "database": "<approved-database>",
  "port": 5432,
  "serverIp": "<pinned-private-IP>",
  "systemIdentifier": "<observed-cluster-ID>",
  "networkEvidenceSha256": "<hash-of-actual-reviewed-network-controls>",
  "productionRoutesDenied": true,
  "internetEgressDenied": true,
  "consumersStopped": true,
  "cronLaunchActiveJobs": false,
  "independentlyReviewed": true,
  "observedAt": "<fresh-UTC-time-within-15-minutes>",
  "approvedTargetOnlyRoles": []
}
```

Exact restore invocation on that approved host:

```sh
timeout --signal=TERM --kill-after=10s 26m python3 scripts/release/managed-auth-recovery.py restore --execute --archive /private/managed-auth-backup.tar.gpg --output /private/managed-auth-restore-receipt.json
```

It verifies ciphertext/source/member pins, then checks the actual connected server and baseline before writes. `auth.schema_migrations`, `storage.migrations` and `realtime.schema_migrations` must match captured row fingerprints exactly; only those proven-identical service marker rows are skipped. Every other target table must be empty, including extension-owned configuration rows outside those namespaces; target large objects must also be absent. Unreviewed seed rows stop before writes rather than being overwritten. Captured sequence values remain included. Other preinstalled non-extension definitions outside Auth/Storage/Realtime stop before writes as `unsupported_preinstalled_baseline_collision`; they require an explicit additional baseline reconciliation, not blind replay. Missing application/private/history definitions and all applicable data are restored with original owners/ACLs; there is no `--clean`, managed-schema drop, `--no-owner`, `--no-privileges`, re-encryption or UUID replacement. Trigger execution is suppressed only for the isolated import using transaction-local session state and must not be treated as network isolation. The operator verifies all captured table/matview row proofs, sequences, large objects, roles and full schema/owners/policies/grants afterward. Any conflict or postcheck failure leaves the target quarantined for review; no retry against production and no automatic target deletion.

## Gates this database receipt cannot satisfy

Even successful actual capture and isolated restore set `fullProjectRecoveryQualified=false`. The following separate existing provider/operator evidence is still required before root can claim the backup/restore contract passes:

| Separate scope | Required private qualification |
|---|---|
| Storage object bytes | Enumerate complete object versions and capture/download bytes through the supported provider route into encrypted backup; restore objects in isolation and verify byte/size/checksum/version receipts. `storage.objects` metadata and ownership do not back up bytes. Prove an empty-byte scope if actually empty. |
| Managed Auth configuration | Supported export/record and isolated recovery of provider settings, Google OAuth client/callback, redirect allowlist, Auth URLs, SMTP, hooks, session/password/MFA settings and external OAuth-client custody. Encrypt private configuration; emit sanitized scope receipts. |
| Hosted runtime key custody | Establish supported provider recovery of hosted signing/JWT/envelope/MFA keys and any associated original encryption material. Preserving encrypted database records is necessary; a new owned AES key cannot decrypt hosted provider envelopes. Do not rotate/revoke originals to solve this gate. |
| Database role password custody | This capture preserves role attributes, membership, settings, owners and grants, but intentionally does not extract server login passwords. Supported provider/approved custody must qualify reconnect/recovery separately. |
| Side effects and infrastructure | Recover definitions/config without enabling Cron, workers, hooks, production egress or hosted services on the restore target. Capture service/image/config versions and original private settings through supported access. |
| Hosted account acceptance | Verify recovery of Google login and account UUID/identity linkage through supported provider adoption; a database hash is not a functioning OAuth/login receipt. |

The live aggregate already established that both existing hosted identities use Google. Keep their production login serving. This gate is bound to base `db8ca50c78be9bd72399673621a9c5386a3e8a39`/tree `48cb5889dc7f60df7414201564b8cf049ae12161` plus the reviewed `dual-hosted-google.patch` (SHA-256 `72d37cd3d7740c80ffd12a8058482a7669eed49ee83929f8cf51344aa8928289`), not the original image. After the exact repaired image/provenance is qualified, matching compiled/server `dual` may preserve the explicit **Log in with existing Google** entry while `VITE_KOVA_GOOGLE_AUTH_ENABLED=false`. Require actual hosted `external.google` availability and both owners' live hosted start/consent through `https://kovagpt.com/~oauth/callback` to their same UUID and real backend authorization. This is an explicit entry, never silent fallback after owned failure; active/rejected owned cookies and unavailable probes must fail closed through `resolveLegacyAuthContext`. Workflow defaults remain `supabase`/Google `false` until the source-bound activation gate passes.

Owned Google separately requires production `KOVA_GOOGLE_CLIENT_ID`/`KOVA_GOOGLE_CLIENT_SECRET`, callback `https://kovagpt.com/api/auth/google/callback`, browser-bound exchange and same-UUID/backend proof before compiling the owned Google flag `true`. The browser flag is UI configuration; `false` does not disable server endpoints when credentials are present. No pure `kova` or hosted retirement before fresh full adoption/MFA census and cutover evidence. After any retirement, rollback must retain compatible guarded dual/owned support; a hosted-only image is not a safe rollback. No staging encrypted record, staging AES replacement or exposed signing key is a production prerequisite.

## Local evidence and limitations

Only this new route's focused synthetic/mocked checks were run. They exercise protected workflow wiring, exact source/destination guards, original data-preservation boundary, marker-table reconciliation, malformed archive rejection, failure cleanup, caps/deadlines, role/ACL/schema mismatches and a restore prewrite stop. The cipher in the mocked capture test is explicitly synthetic. Actual GPG cannot start its agent on this scratch host because Unix sockets are denied, so its real synthetic round-trip test is skipped. No live backup, decrypt, restore, provider config/custody, Storage-byte recovery or production login is qualified here. Previously passing 82/74 checks and completed workflow/runtime closure checks were reused, not rerun.

Primary references: Supabase [restore from Platform](https://supabase.com/docs/guides/self-hosting/restore-from-platform) and [backup/restore migration](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Their managed-schema/version caveats support fail-closed qualification; no workaround that discards account rows is adopted.
