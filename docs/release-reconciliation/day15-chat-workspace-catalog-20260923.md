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

| Capture                                                                                                            | Observed state                                                                                                                                                      | Exact capture file SHA-256                                         |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Four table catalogs](./evidence/day15-live-chat-table-catalog-20260923.json), 2026-09-23 21:28:43.102 UTC         | 98 migration versions; the four scoped tables have 13/7/14/9 columns, 10/5/12/8 constraints, 5/2/5/4 indexes, four policies each, 2/1/1/1 triggers, and RLS enabled | `e17f1358d0fc1fc1161a109742bf68ea27d49c7ae4efcff0468732b6eeb75c45` |
| [Selected routine families](./evidence/day15-live-chat-routine-catalog-20260923.json), 2026-09-23 21:32:51.515 UTC | 98 migration versions; 19 matching routines across the 22 selected name families, none marked SECURITY DEFINER and none effectively executable by `anon`            | `bd5c452488da5ff7a55a8072887f8ffbbaa81ae179756f6f1091614d32af71ce` |
| [Four table data compatibility counts](./evidence/day15-live-chat-data-counts-20260923.json)                       | All four table row totals were zero in a separate read-only count transaction; 24 named violation counts were zero in a later transaction                           | `b09c422b7d7ffa23a0a8dc89895495f32ae1bf2352b8a28b8c0f7360a60eee1d` |

The checked-in snapshots are observational records of read-only tool responses. Their SHA-256 values bind their bytes but do not independently authenticate their origin. The catalog outputs contain PostgreSQL metadata (column names and types,
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
snapshot, use:

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
ledger, isolation/read-only flag, chronology, catalog shape, or data-count
shape. It reports baseline-to-live and final-source-to-live differences in
each scope, and never changes the schema-proof status.

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
