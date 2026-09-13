# Production history upgrade rehearsal

The isolated database CI job now rehearses both a fresh source installation and an upgrade from the September 4, 2026 production migration history. Neither command connects to a hosted Supabase project.

## Reviewed baseline

The read-only capture contained **97 migration versions and 1,042 SQL statements**. Seventy-four versions have source files with matching SQL tokens, including unchanged string literals. The remaining 23 versions are reviewed structural fixtures under `tests/fixtures/production-migration-history-20260904/`.

The fixture manifest pins every replay file by SHA-256. It also records the original statement count, SHA-256, and MD5 of statement strings joined by LF. All 97 LF-joined MD5 values were checked against the separately captured migration ledger. The fixtures contain schema/function/policy history, not production application rows, credentials, or a database dump. They remain outside `supabase/migrations` so normal release commands cannot mistake them for pending production migrations.

The baseline deliberately retains production-only versions. The rehearsal neither deletes their history nor marks an unexecuted source migration as applied. It applies every source version absent from the captured history, including earlier timestamps, using `migration up --local --include-all` in the disposable project.

## Commands and evidence

```bash
npm run release:db:upgrade:dry
npm run release:db:upgrade
```

The dry command verifies file hashes, ordering, origins, statement count, duplicate versions, and the pending source range. It executes no database command and returns `executed: false`.

The full command requires the locked project dependency's Supabase CLI and a local Docker daemon at `/var/run/docker.sock`. It creates a unique temporary project, uses PostgreSQL 17, disables seed auto-discovery, and strips inherited Supabase/database credentials and alternate Docker contexts. The project contains no link metadata, `.env`, or source project configuration. SQL uses `docker --host unix:///var/run/docker.sock exec ... psql` against only the generated container name. No command accepts a remote target argument.

The sequence is:

1. Start and reset the disposable stack with the 97 reviewed baseline files.
2. Assert the exact baseline version set, then insert synthetic two-user history.
3. Copy the pending source files and apply that range locally.
4. Check the final version set and catalog/data assertions.
5. Stop the generated project without a backup and remove its temporary files.
6. Write `artifacts/release/upgrade-database.json` only after every step succeeds, including cleanup.

Evidence includes the source commit, baseline manifest hash, every pending migration hash, seed/assertion hashes, and completion time. Failed runs remove any stale success artifact, retain a local failure log, and return a failing exit status. The existing isolated database CI job uploads the evidence artifact on either outcome.

## Assertions and discovered repair

The upgrade checks RLS on the new user/account tables, explicit client denial on server-only tables, absence of client DDL privileges, every canonical workspace overload's invoker/ACL contract, service-only cleanup functions, UTF-16 length, the 512-message branch limit, version/branch integrity, and outbox survival after Auth deletion. A transactional probe also proves new functions do not regain default public execution and the family-owner helper rejects another user's scope.

Synthetic history includes a 200-character chat ID, a `retry` version with canonical `instruction`, a UTF-16 emoji selection, and an `active` pin. Owner reads must survive the upgrade; the second user must see none of that history.

Replaying the captured workspace lineage exposed an upgrade-only defect in the **source-only** `20260823220701` migration: it assumed the retired `edit_instruction` column and transient 128-character/`regeneration`/`ready` representation. The source migration now accepts the already-canonical production representation without adding a retired column or tightening valid existing labels/IDs. The later reconciliation still establishes the final canonical constraints. None of the 97 captured production versions was modified.

## Verification boundary

Executable PGlite tests replay all ten captured Day-15 workspace migrations, populate synthetic history, and apply the five pending workspace migrations without altering their SQL. They verify data preservation, owner isolation, and selected-range validation. Separate orchestration tests cover baseline drift, duplicate/path/order rejection, phase ordering, local targeting, failed startup, assertion failure, cleanup failure, and stale evidence removal.

The authoring workspace has no Docker daemon, so these local tests do not claim the complete Supabase stack upgrade passed. The hosted `isolated-database` job is authoritative for that result. A green rehearsal verifies this captured structural baseline with synthetic data; live migration authorization, current target verification, backup/PITR evidence, and actual production data compatibility remain distinct release requirements.
