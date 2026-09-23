# Day-15 chat-workspace catalog and data checkpoint — 2026-09-23

All ten Day-15 remote-only lineage entries remain `requires_schema_proof`.
These collectors add bounded, reproducible scope to the current-history
isolated upgrade run. The collector is source-only until its exact-head hosted
rehearsal succeeds and the resulting artifacts are independently reviewed.
It does not repair migration history, apply SQL in production, or promote a
mapping.

## Captured read-only live state

Four separate PostgreSQL `REPEATABLE READ, READ ONLY` transactions on
project `mfbycmbjygcfkrsuepxf` returned:

| Capture                                                                                                                   | Observed state                                                                                                                                                                                                                                                                                                     | Exact capture file SHA-256                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [Four table catalogs](./evidence/day15-live-chat-table-catalog-20260923.json), 2026-09-23 21:28:43.102 UTC                | 98 migration versions; the four scoped tables have 13/7/14/9 columns, 10/5/12/8 constraints, 5/2/5/4 indexes, four policies each, 2/1/1/1 triggers, and RLS enabled                                                                                                                                                | `e17f1358d0fc1fc1161a109742bf68ea27d49c7ae4efcff0468732b6eeb75c45` |
| [Selected routine families](./evidence/day15-live-chat-routine-catalog-20260923.json), 2026-09-23 21:32:51.515 UTC        | 98 migration versions; 19 matching routines across the 22 selected name families, none marked SECURITY DEFINER and none effectively executable by `anon`                                                                                                                                                           | `bd5c452488da5ff7a55a8072887f8ffbbaa81ae179756f6f1091614d32af71ce` |
| [Four table data compatibility counts](./evidence/day15-live-chat-data-counts-20260923.json), 2026-09-23 21:52:25.748 UTC | All four [table row totals](./evidence/day15-live-chat-row-totals-20260923.json) were zero in a separate read-only count transaction; 24 named violation counts were zero in a later transaction. The revised branch-array check uses total `cardinality(message_ids) > 512` to match the final source constraint. | `23e57b81385d47d87ff5350310c07027716d46f57064bfcbf77eca729d450db0` |

The row-total file SHA-256 is `f1f75298d3c779316168b3e88d5e7085ae92246d078a6d8a1ecf3e39f4c18c0d`. The checked-in snapshots are observational records of read-only tool responses. Their SHA-256 values bind their bytes but do not independently authenticate their origin. The catalog outputs contain PostgreSQL metadata (column names and types,
constraint/index and policy definition hashes, grants and effective role
privileges, routine signatures/definition hashes, owner, security mode and
search paths). They contain no customer row, message, content value, or
customer identifier. The data compatibility output contains counts only.
All four row totals being zero makes row-conversion checks vacuous at this
checkpoint; it does not prove future writes or other application tables.
The separately executed transactions are not an atomic combined snapshot.

The family names present in source but absent in this live _selected-family_
capture are `kova_can_pin_source`, `kova_chat_branch_lineage_guard`, and
`kova_set_updated_at`. This reflects candidate source evolution; it does
not establish whether their final effects are equivalent to live functions,
policies, or triggers. The 19 observed routine bodies were returned as
digests, not executable bodies or customer content.

The existing full-source temporary-export scan covers all 157 migration
files at source commit `eb5596c77bc6309dc4856b716ac7f4143add13c1`,
tree `63e543e367a1ffa7d1165544d1ba8b869dbfe263`, and found zero
references to `_kova_temp_export_day15`. Its candidate
`20260824090000` has SHA-256
`5c86b2c7f26d1a3bff47cb43db71ee0ff5291e01ebfb278c0edb9a6841f6a034`.
The temporary-export _live_ scoped absence comparison is tracked in PR #399.
These findings do not establish all dependencies or historical equivalence.

## Reproduce the source and live comparison

An exact-head hosted `npm run release:db:upgrade` now records baseline
(the captured 98-version source history) and final isolated source snapshots
in `artifacts/release/upgrade-chat-workspace-table-catalog.json` and
`artifacts/release/upgrade-chat-workspace-routine-catalog.json`, with both
files' SHA-256 digests and query digests pinned to `upgrade-database.json`.
The CI `database-upgrade-evidence` artifact already uploads
`artifacts/release/upgrade-*`. The isolated run seeds synthetic data, and
the existing application assertions run before these final captures.

After obtaining a fresh live capture **later** than the hosted final
snapshot, wrap each raw catalog response in an exact-key JSON envelope with
`schemaVersion: 1`, `projectId: "mfbycmbjygcfkrsuepxf"`, `capture` set to
the raw SQL `capture`, the matching source `querySha256`, and `captureKind`
set respectively to `"chat-workspace-live-table-catalog"` or
`"chat-workspace-live-routine-catalog"`. Independently verify both capture
requests selected that project; the client-written project field cannot
authenticate itself. The checked-in catalogs are earlier raw observations,
not these fresh envelopes. Use the same fixed aggregate SQL for a fresh count capture. Package
its result in an exact-key JSON envelope containing `schemaVersion: 1`,
`captureKind: "chat-workspace-aggregate-violations"`,
`projectId: "mfbycmbjygcfkrsuepxf"`, the client-recorded UTC `capturedAt`,
`catalogLedgerSha256` (SHA-256 of the live catalog's ordered versions joined
with newlines), `querySha256`, `counts`, `observedViolationCount`, and false
`schemaProofPromoted`/`productionReleaseReady` markers. The count SQL still
returns aggregate counts only. The checked-in September 23 count record has
this envelope, but it precedes the exact-head hosted rehearsal, so a later
fresh capture is still required for the comparison. Then use:

```bash
node scripts/release/compare-live-chat-workspace-catalog.mjs \
  /path/to/upgrade-database.json \
  /path/to/upgrade-chat-workspace-table-catalog.json \
  /path/to/upgrade-chat-workspace-routine-catalog.json \
  /path/to/fresh-live-tables.json \
  /path/to/fresh-live-routines.json \
  /path/to/fresh-live-data-counts.json
```

The comparator fails closed on a changed receipt, artifact bytes, query,
ledger, catalog isolation/read-only flag, chronology, catalog shape, or
data-count envelope/shape. It reports baseline-to-live and final-source-to-live
differences in each scope, and never changes the schema-proof status. The
client-recorded count timestamp, project, and catalog-ledger digest associate
separately observed transactions; they cannot independently attest query
provenance, database transaction flags, or atomicity. The catalog envelopes
likewise require independent verification against the connector request.

## Remaining acceptance work

1. Obtain green exact-head hosted isolated evidence for the new collectors.
   Our local runtime has no Docker engine or `psql`, so it cannot substitute
   for the hosted PostgreSQL replay.
2. Capture a fresh read-only live catalog **after** that hosted run and
   compare to both source checkpoints. Resolve every actual table, function,
   grant, policy, and trigger difference with later-writer analysis; do not
   normalize real drift away.
3. Establish all read-model and function dependency closure, including views,
   security modes, callable overloads, private helpers, default arguments,
   UTF-16 selection boundaries, and named/positional PostgREST resolution.
4. Exercise synthetic cross-user denial, branch/version integrity, retention,
   concurrency, and valid legacy conversion on isolated PostgreSQL.
5. Bind each scoped result to the 19-entry version-2 proof contract, obtain
   independent acceptance, and update lineage only once _all_ associated
   conditions pass. No such promotion is made here.

This scope overlaps the other nine blocked entries through later writers.
The catalog matches alone are never proof that each remote historical
operation had identical effects.
