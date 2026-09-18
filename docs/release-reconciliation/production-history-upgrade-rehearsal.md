# Production history upgrade rehearsal

The isolated database CI job rehearses both a fresh source installation and an upgrade from the reviewed structural history. The original September 4, 2026 baseline remains unchanged; the default npm commands now add the separately verified September 18 supplement described below. Neither command connects to a hosted Supabase project.

## Reviewed baseline

The read-only capture contained **97 migration versions and 1,042 SQL statements**. Seventy-four versions have source files with matching SQL tokens, including unchanged string literals. The remaining 23 versions are reviewed structural fixtures under `tests/fixtures/production-migration-history-20260904/`.

The fixture manifest pins every replay file by SHA-256. It also records the original statement count, SHA-256, and MD5 of statement strings joined by LF. All 97 LF-joined MD5 values were checked against the separately captured migration ledger. The fixtures contain schema/function/policy history, not production application rows, credentials, or a database dump. They remain outside `supabase/migrations` so normal release commands cannot mistake them for pending production migrations.

The baseline deliberately retains production-only versions. The rehearsal neither deletes their history nor marks an unexecuted source migration as applied. The historical mode applies every source version absent from the captured history, including earlier timestamps, using `migration up --local --include-all` in the disposable project. Current-history mode accounts separately for the one byte-identical security migration already executed while building the baseline; its canonical timestamp remains unresolved rather than being fabricated.

## Commands and evidence

```bash
npm run release:db:upgrade:dry
npm run release:db:upgrade
```

The dry command verifies file hashes, ordering, origins, statement count, duplicate versions, and the pending source range. It executes no database command and returns `executed: false`.

The full command requires the locked project dependency's Supabase CLI and a local Docker daemon at `/var/run/docker.sock`. It creates a unique temporary project, uses PostgreSQL 17, disables seed auto-discovery, and strips inherited Supabase/database credentials and alternate Docker contexts. The project contains no link metadata, `.env`, or source project configuration. SQL uses `docker --host unix:///var/run/docker.sock exec ... psql` against only the generated container name. No command accepts a remote target argument.

The sequence is:

1. Start and reset the disposable stack with the 97 historical baseline files and, in current-history mode, the one verified supplement.
2. Assert the exact baseline version set, then insert synthetic two-user history.
3. Copy and apply the execution range locally. Current-history mode excludes only the verified, byte-identical security body already executed under its remote baseline timestamp.
4. Check the final version set and catalog/data assertions.
5. Stop the generated project without a backup and remove its temporary files.
6. Write `artifacts/release/upgrade-database.json` only after every step succeeds, including cleanup.

Evidence includes the source commit, baseline manifest hash, the raw source-pending inventory, each forward-execution migration hash, seed/assertion hashes, and completion time. Full runs remove stale success evidence before validating either baseline or supplement. A preflight failure writes only a bounded validation code to the failure artifact, not parser input or filesystem paths. Successful and failing dry runs leave existing artifacts untouched. Database failures remain failures, with cleanup and their diagnostic log preserved. The existing isolated database CI job uploads the evidence artifact on either outcome.

## Assertions and discovered repair

The upgrade checks RLS on the new user/account tables, explicit client denial on server-only tables, absence of client DDL privileges, every canonical workspace overload's invoker/ACL contract, service-only cleanup functions, UTF-16 length, the 512-message branch limit, version/branch integrity, and outbox survival after Auth deletion. A transactional probe also proves new functions do not regain default public execution and the family-owner helper rejects another user's scope.

Synthetic history includes a 200-character chat ID, a `retry` version with canonical `instruction`, a UTF-16 emoji selection, and an `active` pin. Owner reads must survive the upgrade; the second user must see none of that history.

Replaying the captured workspace lineage exposed an upgrade-only defect in the **source-only** `20260823220701` migration: it assumed the retired `edit_instruction` column and transient 128-character/`regeneration`/`ready` representation. The source migration now accepts the already-canonical production representation without adding a retired column or tightening valid existing labels/IDs. The later reconciliation still establishes the final canonical constraints. None of the 97 captured production versions was modified.

## Verification boundary

Executable PGlite tests replay all ten captured Day-15 workspace migrations, populate synthetic history, and apply the five pending workspace migrations without altering their SQL. They verify data preservation, owner isolation, and selected-range validation. Separate orchestration tests cover baseline drift, duplicate/path/order rejection, phase ordering, local targeting, failed startup, assertion failure, cleanup failure, and stale evidence removal.

The authoring workspace has no Docker daemon, so these local tests do not claim the complete Supabase stack upgrade passed. The hosted `isolated-database` job is authoritative for that result. A green rehearsal verifies this captured structural baseline with synthetic data; live migration authorization, current target verification, backup/PITR evidence, and actual production data compatibility remain distinct release requirements.

## September 18 current-history supplement

The successful artifact from main CI run `35299123802` reports `baselineVersions: 97`. A new read-only ledger capture at `2026-09-18T16:22:53.396351+00:00` contains 98 versions and 1,043 statements. That older artifact is valid historical rehearsal evidence, not proof that the current 98-version state has been rehearsed.

`current-supplement-20260918.json` preserves the original manifest rather than rewriting its capture date or counts. Before creating any local database, current-history mode verifies the pinned historical manifest hash, all 97 ordered statement-metadata tuples against the fresh ledger digest, and the one additional remote entry:

- Remote version: `20260906024459`, `remediate_security_advisor_warnings`.
- Source: `supabase/migrations/20260903145843_remediate_security_advisor_warnings.sql`.
- One statement, 10,537 bytes; SHA-256 `7f479d52a2fddc859d1603932c8b59dbe8b481bcd77e3062b3b94427a631689d` and MD5 `bc86946a173a6c4b0ea4715c02e65b5c`.

The historical metadata digest is SHA-256 of rows joined by LF, with no trailing LF. Each row is `version|statementCount|capturedStatementsSha256|capturedStatementsMd5`, in ascending version order. Only metadata and hashes were read from the live ledger; no statement text or customer rows were exported for this supplement.

The byte-equivalent source is copied under its **remote** filename only inside the generated disposable project's baseline. Its canonical source timestamp stays in the raw `pendingVersions` inventory. Once its bytes, size, SHA-256, MD5, exact mapping and historical receipt are validated, that same body is not copied a second time into the forward execution range. This exception is restricted to the single pinned security mapping; unrelated pending migrations remain in the execution range. No canonical history row is inserted, and no history repair command runs.

Baseline and final assertions check the exact versions actually executed: the 98 baseline versions plus the forward execution range. For the reviewed 157-file source set, there are 83 raw source-pending versions, 82 forward executions and 180 expected final history rows. The absent canonical security timestamp is explicitly retained as an unresolved history requirement. The original fixture manifest, captured SQL, production migration files, assertions, seed and production release preflight are unchanged.

The CLI defaults to the supplemented snapshot, so the unchanged npm commands and CI now exercise 98 versions. The programmatic `rehearseUpgrade` API preserves its historical default; callers select `currentHistory: true` explicitly. The historical 97-version CLI check remains available:

```bash
node scripts/release/upgrade-database.mjs --historical-baseline --dry-run
```

Successful current-history evidence must report 98 baseline versions, 1,043 baseline statements, and the supplement and ledger-metadata hashes. `baselineSha256` identifies the unchanged historical manifest. `pendingVersions` preserves the raw timestamp gap; `replayPendingVersions` and `forwardMigrations` identify only the executable forward range. `currentHistory.contentEquivalentBaselines` identifies the exact body satisfied by baseline execution. The evidence always retains `requiresCanonicalHistoryReconciliation: true`, `productionReleaseReady: false`, `productionRowsRestored: false` and `liveCatalogEquivalenceProven: false`.

The production preflight still rejects unreconciled canonical history and all outstanding schema-proof entries. A successful synthetic rehearsal does not override those checks. A failed preflight or local run must not be treated as successful current-history evidence.

## Failure found in the first 98-version attempt

CI run `35370841729`, job `105688213807`, on head `105d157d8ba610c6a18a72a08fd8d2c6c48ba33f` passed fresh source installation but failed the current-history forward replay. Artifact `10557989095` is 680 bytes with SHA-256 `b96618ab4795b823af95aa4f2976f2faf6be6a430eda30987a7e81a15f13d97f`; it contains a failure log, not success evidence.

Reapplying canonical `20260903145843` after the identical remote `20260906024459` body failed at `alter function public.accept_project_invite(uuid) set schema kova_private` with SQLSTATE `42723`. The private implementation already existed. This was a deterministic double application, not the earlier transient container-image rate-limit warnings.

The corrected execution plan therefore runs this verified body once under the captured remote timestamp, instead of forcing a second application or pretending that the canonical history row exists. It does not catch-and-ignore SQLSTATE `42723`, drop the existing function, rewrite the recorded migration, suppress assertions, or repair a ledger. Other database errors still fail the run. Current-head hosted verification must validate the revised plan; the failed predecessor must never be relabeled successful.

This is a structural replay with synthetic data, **not a restore of production backup `35346103522`**. It neither authorizes a remote operation nor promotes any of the 19 outstanding `requires_schema_proof` entries. Unrecorded live catalog drift, actual backup data, Storage bytes, provider configuration, passphrase recovery, and isolated real-backup restore/rollback remain separate gates.
