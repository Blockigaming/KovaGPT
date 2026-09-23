# Scheduled grant drift: exact scoped breakdown

The two scheduled remote-only entries `20260823092107` and `20260823092450`
remain `requires_schema_proof`. This report expands the [read-only live catalog
comparison](./scheduled-live-comparison-20260923.md) to show explicit grant and
effective privilege deltas separately. It does not reconcile migration history,
alter any grant, or promote a mapping.

## Bound captures

- Isolated baseline: hosted CI run `35635159447`, source commit
  `6642e8c109ca7fce346fa3a760976d5a09aaae2f`, 98 migration versions;
  exact named artifact digests are bound by `upgrade-database.json`.
- Live read-only captures at `2026-09-23T00:15:51.935Z` (tables) and
  `2026-09-23T00:15:53.365Z` (routines), with the same ordered 98-version
  ledger. The selected Supabase target was `mfbycmbjygcfkrsuepxf`; the catalog
  files do not independently authenticate the project reference.
- The table live-capture SHA-256 is
  `eccc8a0d4659ea297566d92537c31d01180ac766cc7fac0eb9083b67a93b8396`;
  the routine live-capture SHA-256 is
  `880d545700702cd99fdc83b4e481a7ebe0b73a435c0dd84e7cda33a716593466`.
  Both captured transactions reported repeatable-read/read-only and returned
  only catalog metadata, without application rows or raw function bodies.

## Differences against the 98-version isolated baseline

All table columns, defaults, constraints, indexes, RLS policies, and triggers in
the captured two-table scope match. All seven captured routine definitions and
metadata match. The live catalog has the following **extra explicit grants**;
none of these listed grants is present in the isolated baseline:

| Object                                                    | Live grant recipients and privileges beyond baseline                                                            | Effective access difference                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `public.scheduled_task_runs`                              | `anon`: SELECT, INSERT, UPDATE, DELETE; `authenticated`: same four; `service_role`: same four (12 extra grants) | Those DML privileges change from false to true for each role. Other service privileges already match.            |
| `public.scheduled_tasks`                                  | `anon`: SELECT, INSERT, UPDATE, DELETE (four extra grants)                                                      | Those four privileges change from false to true for `anon`; authenticated and service access otherwise match.    |
| `public.next_scheduled_task_occurrence(timestamptz,text)` | `anon`, `authenticated`, `service_role`: EXECUTE (three extra grants)                                           | No effective EXECUTE change: the already present PUBLIC grant makes each role able to call it in both snapshots. |

No scoped column grants or per-column ACL storage changes explain the table
differences. These are genuine grant differences, not a serialization-order
artifact. RLS policies constrain `anon` and `authenticated` rows, but the
captured `service_role` has `BYPASSRLS`; its newly effective table DML is not
filtered by those policies. The catalog alone cannot establish which rows
the client roles can access. The recurrence helper is a separate function from
the service-only claim/recovery/settlement routines. The six mutating routine
ACLs and their effective API-role privileges match the baseline.

The table `effectiveChanges` field compares only `has_table_privilege` for the
captured API roles. The collector does not capture `has_column_privilege`, so
column-level effective access cannot be inferred from an empty
`effectiveChanges` array. Table deltas explicitly say
`columnEffectiveAccess: "not_captured"`; their `columnAcl` fields show explicit
column grants only. For source-final comparisons, column ACL storage is compared
only between columns with the same name. Added or removed columns appear in the
separate schema change report, not as ACL storage drift. Added routine scopes
include their live grants and effective EXECUTE privileges.

The recorded source migration for `scheduled_tasks`
(`20260627210732`) grants authenticated DML and full service access. The source
creation of `scheduled_task_runs` (`20260722123000`) has no equivalent explicit
DML grants in the retained 98-version replay, and neither scheduled remote-only
statement contains table DML GRANTs. The recorded August 23 privilege hardening
removes stronger table privileges while preserving DML. These facts **do not
establish who added the live grants or when**. Do not erase them with a grant
normalizer, alter the retained historical fixtures to force equality, or issue
production REVOKEs as a proof shortcut.

## Separate mapping and later-writer limits

The two remote statement fixtures have different SHA-256 values:
`6dd86a55e89eeeacf8748e8a52cc4a0380e0e7d2c820a58cda6eb1ea07de9171`
for `20260823092107` and
`2eff97e0ec1850da40c3499cc310b583007adf321d9c8287386685421e7e7b9a`
for `20260823092450`. The later statement replaces the scheduled functions and
contains a settlement-contract marker absent from the earlier record. Both
entries require individual historical-effect review before treating their
ordered result as a candidate source effect.

The source-final 180-version rehearsal is a separate checkpoint. Later source
migrations change scheduled task columns/policies/triggers and six captured
routine definitions/privilege sets. Its current mismatch with the 98-version
live catalog must remain visible; do not mislabel it as historical equivalence.

Next proof inputs: independently attributed historical grant origin, reviewed
later-writer and transitive dependency scope, exact checkpoint comparisons of
both recorded statements, synthetic RLS/lease/concurrency checks in a
disposable database, complete v2 source/remote proof artifacts, and independent
acceptance. Until then, all 19 mappings remain blocked.

Run `node scripts/release/compare-live-scheduled-catalog.mjs` with the five
receipt/artifact/capture paths in the linked comparison report to reproduce
the full scoped differences. Its `baseline.grantDeltas` and
`sourceFinal.grantDeltas` fields distinguish added/removed explicit grants
from effective role access. All promotion and readiness flags remain false.
