# Temporary-export removal: isolated catalog evidence

This collector advances only remote entry `20260824085042`, whose reviewed
structural fixture drops `public._kova_temp_export_day15(text)`. It does not
promote that entry or any other entry in `release-migration-lineage.json`.
All 19 structural proofs remain independently release-blocking.

## Why another artifact is needed

The existing fingerprint utility hashes a caller-provided snapshot. It does not
prove that an empty category came from a successful catalog query. The current
98-version upgrade rehearsal checks structural compatibility, but previously did
not retain the catalog observations needed to compare this particular removal
against a separately captured live state.

The new collector performs the same bounded, repeatable-read, read-only query
before synthetic seeding and after the final upgrade-history assertion. It runs
through the existing disposable project's explicit local Docker socket and
container name. It never connects to hosted Supabase or invokes the removed
function or any other application RPC.

The current-history CLI enables this capture by default. The exported
`rehearseUpgrade` API remains backward-compatible; callers explicitly pass
`captureTemporaryExport: true` together with `currentHistory: true`. The historical
CLI opt-out remains historical and does not produce this new proof artifact.
Dry runs execute no SQL and leave previous artifacts unchanged.

## Exact capture boundary

The query checks the exact public signature and all case-insensitive routine-name
matches across all schemas. It counts catalog dependencies on that routine family
and literal case-insensitive references in other `pg_proc.prosrc` bodies. It
returns neither those bodies nor application rows. Public-schema and built-in
routine sentinels must be present so a missing schema or non-working catalog read
cannot be mistaken for successful absence.

The receipt includes the UTC capture time, PostgreSQL 17 version number, database
name, read-only/isolation flags, and the complete ordered migration-version set.
The validator rejects wrong types, extra or missing fields, unexpected routines
or references, count-only matches, missing removal history, unordered/duplicate
versions, invalid timestamps and unbounded or malformed process output. The exact
version set must equal the already-validated baseline or final execution plan.
The source commit and tree must be full commit/tree hashes, not branch labels.

The query reads PostgreSQL catalogs and migration version metadata only. It uses
10-second statement and 1-second lock timeouts and a catalog-only search path.
Inherited production credentials remain stripped by the existing runner.

## Artifact and linking

After both catalog reads, all pre-existing SQL assertions and local cleanup
succeed, the runner writes `artifacts/release/upgrade-temp-export-proof.json`.
`upgrade-database.json` records its filename, byte SHA-256 and query SHA-256.
The unchanged CI artifact glob already includes this file. A capture failure
fails the rehearsal; it is not caught and converted into empty categories.
Full runs remove any stale proof artifact before validating their inputs.
No success artifact is written before cleanup.

The proof file preserves the complete observations and exact source commit/tree.
Each checkpoint contains a scoped snapshot plus the four existing fingerprint
categories. Checkpoint time, PostgreSQL patch level and version-history digest
remain outside those fingerprints but inside the receipt, so comparisons preserve
provenance without making equivalent absence differ merely because time changed.
ACL and RLS categories explicitly record that the routine family is absent; they
are not claims about unrelated table grants or policies.

The evidence always retains:

- `liveCatalogCompared: false` and `schemaProofPromoted: false`;
- `canonicalHistoryReconciled: false`;
- `productionReleaseReady: false` and `productionRowsRestored: false`.

A separate evidence review must bind a live capture to the intended production
project and exact query bytes, validate its observed version set, and compare its
fingerprints with the source-bound isolated receipts. Merely generating this
artifact is not a successful live comparison.

## What this does not prove

The name/body scan does not exclude dynamically constructed references, strings
outside stored routine bodies, or arbitrary application-code behavior. It is not
a whole-schema drift comparison, fresh-source database capture, real-backup
restore, data-compatibility certification, or approval to repair history.

The actual current source migration chain contains no occurrence of the removed
symbol. Candidate source `20260824090000` must not be described as executing the
historical DROP: it is a separate workspace reconciliation. The baseline executes
the recorded removal, and this collector proves its absence is preserved at the
observed checkpoints. Historical effect, candidate-source/later-writer review,
recovery evidence and independent approval remain separate obligations before
any lineage promotion.

## Validation

```bash
node --test tests/unit/upgrade-database-temp-export-proof.test.mjs \
  tests/unit/upgrade-database.test.mjs \
  tests/unit/upgrade-database-current-history.test.mjs
node scripts/release/upgrade-database.mjs --dry-run
```

Unit tests exercise strict receipts, exact history binding, provenance-preserving
fingerprints, fatal capture errors, before-seed/after-upgrade ordering, artifact
hash linkage, local-only process targeting, dry-run immutability and cleanup.
Process orchestration is mocked in these tests. The real PostgreSQL/Supabase
rehearsal and its exact-source uploaded artifacts require hosted validation.
The source-scan test separately checks the recorded DROP fixture, current source
symbol absence, and preservation of the 19-entry blocked lineage inventory.
