# Temporary-export live catalog comparison — 2026-09-23

Remote migration `20260824085042` remains `requires_schema_proof`. The
full-source proof already scans all 157 byte-verified migrations at pinned
commit `eb5596c77bc6309dc4856b716ac7f4143add13c1` for
`_kova_temp_export_day15` and binds candidate `20260824090000`. Running that
proof again on 2026-09-23 succeeded with no matching source files. This report
adds a reproducible comparison of the separate _scoped_ live catalog capture;
it does not promote the mapping.

## Exact comparison

- Connected project selected by the operator: `mfbycmbjygcfkrsuepxf`,
  database `postgres` on PostgreSQL 17. The capture itself does not attest
  the project ref.
- Hosted rehearsal: KovaGPT CI run `35635159447`, source commit
  `6642e8c109ca7fce346fa3a760976d5a09aaae2f`, source tree
  `fb265d07798304b1bbb71a7b4169f055f90a97e7`, 98-version baseline and
  180-version source-final checkpoint.
- `database-upgrade-evidence` artifact `10656073978` ZIP SHA-256:
  `41fdde863422db38328e60cf0bdcd2ebc14ad2d248a4d8a880788981a0f127bd`.
  Its receipt binds `upgrade-temp-export-proof.json` at SHA-256
  `776980840a3442520c9b6b7b078e706bc7e94e706855095b8396ac15f8b63e31`.
- Collector query SHA-256:
  `e6dbb8b559b88ea1696b7e229b73269fd464d0c90f3306721e7fd19a66a2b140`.
  The exact exported SQL ran in a `REPEATABLE READ`, `READ ONLY` transaction.
- Live capture completed `2026-09-23T00:24:19.868Z`, with the exact
  98-version ledger; its JSON SHA-256 is
  `9c3ef9852f096eeeca1899ab94b8dc40830f498119692eed9d4419d1a221f410`.
  No application rows, messages, customer identifiers, raw routine bodies, or
  secrets were returned; the capture includes migration ledger versions.

The live capture matches both isolated checkpoints within the collector's
scope: the exact `public._kova_temp_export_day15(text)` signature is absent;
the case-insensitive routine family, inbound dependencies, and literal stored
routine-body references all have count zero. The recomputed schema, ACL, RLS,
and function category fingerprints equal both artifact checkpoints. This
absence comparison does **not** cover the candidate migration's full table
shape, data backfill, constraints, policies, dependencies, or later writers.

## Reproduce

Download the hosted ZIP, verify its byte digest, and extract
`upgrade-database.json` and `upgrade-temp-export-proof.json`. Run the exported
`TEMP_EXPORT_CATALOG_SQL` from
`scripts/release/upgrade-database-temp-export-proof.mjs` through the verified
read-only connection and save its single `capture` object as JSON. Then run:

```bash
node scripts/release/compare-live-temp-export-catalog.mjs \
  upgrade-database.json \
  upgrade-temp-export-proof.json \
  live-temp-export.json
```

The comparator rejects mismatched receipt/artifact bytes, collector hashes,
source commit, ledger, chronology, catalog shapes, or recomputed isolated
fingerprints. Its `scopedCatalogMatch: true` is only an absence finding.
`schemaProofPromoted`, `canonicalHistoryReconciled`, and
`productionReleaseReady` remain false. Complete schema evidence, a reviewed
dependency and later-writer scope, data compatibility, an actual backup
restore, and production-history reconciliation remain separate gates.
