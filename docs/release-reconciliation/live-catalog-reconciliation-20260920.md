# Live catalog reconciliation — 2026-09-20

## Decision

Promote only remote migration `20260824085042` (`remove_temporary_day15_source_export`) to
`schema_proven`, backed by `proof-20260824085042`. Keep the two scheduled-object mappings
blocked because their live ACL fingerprints differ from both the 98-migration rehearsal baseline
and source-final state.

This report records read-only catalog evidence. It does not authorize migration-history repair,
schema changes, backup/restore actions, deployment, or production traffic changes.

## Remote capture boundary

- Target project: `mfbycmbjygcfkrsuepxf` (KovaGPT)
- Database: `postgres`
- PostgreSQL `server_version_num`: `170006`
- Transaction: `REPEATABLE READ`, `READ ONLY`
- Observed migration count: `98`
- Latest observed migration: `20260906024459`
- Application/customer rows queried: none
- Catalog and migration metadata only

All three captures passed their strict source validators. The SQL came from the exact merged
collectors on current `main` (`eb5596c77bc6309dc4856b716ac7f4143add13c1`). The rehearsal
artifact's synthetic merge commit `d246292dd07f90ea3575a65d7facad1e953f191f` has no changes
from current `main` within `supabase/`, `scripts/release/`, reconciliation documentation, or the
governing reconciliation review test.

## Evidence provenance

| Scope                    | Captured (UTC)             | Query SHA-256                                                      | Result                    |
| ------------------------ | -------------------------- | ------------------------------------------------------------------ | ------------------------- |
| Scheduled tables         | `2026-09-20T14:22:42.737Z` | `6bb88798ba36bf178a6057a4a14fb4c4941e6925384511c59f7f168257dd46d0` | ACL mismatch; blocked     |
| Seven scheduled routines | `2026-09-20T14:23:36.349Z` | `f29d28e93527edd4437c1be74ecadeecd4c8b74c13a70a0e025a1b36da90aeae` | ACL mismatch; blocked     |
| Temporary export         | `2026-09-20T14:23:53.370Z` | `e6dbb8b559b88ea1696b7e229b73269fd464d0c90f3306721e7fd19a66a2b140` | Exact four-category match |

The isolated exact-head workflow was KovaGPT CI run `35512761346`, artifact
`database-upgrade-evidence` (`10606665034`). The downloaded ZIP independently matched the
reported digest `sha256:383de147866c2d1903cfdb7d204f6f701c36010af9a6c81a7689b621150542ac`.
Its source-final history contained 180 versions; its production-shaped baseline contained the
same 98 versions observed remotely.

## Temporary-export proof

The exact signature was absent, the routine family was empty, and there were zero inbound
dependencies and zero literal stored-routine references in both live production and isolated
source-final captures.

| Fingerprint category | Live production                                                    | Isolated source final |
| -------------------- | ------------------------------------------------------------------ | --------------------- |
| Schema               | `974207baf501e2babe05ef0d20b329a9b020f8a88bc1a7ac505a1a86913e2965` | Same                  |
| ACL                  | `1625cf9ce9407f79f96a762aa02f67465cbc5c1e1c3bb3dba2e56cbe4d6abd95` | Same                  |
| RLS                  | `1625cf9ce9407f79f96a762aa02f67465cbc5c1e1c3bb3dba2e56cbe4d6abd95` | Same                  |
| Function             | `2a1b181d96d9553def58a598ecffbd8e097b612b87b8995c5461c883efba47c5` | Same                  |

The proof is limited to this removed temporary-export object family. A literal stored-routine-body
scan cannot exclude dynamically constructed references. It proves neither other lineage mappings
nor repaired migration history.

## Scheduled-object blockers

The scheduled-table schema, RLS, and trigger fingerprints match the 98-migration rehearsal
baseline, but production ACLs do not. Production grants `anon` all four DML privileges on both
tables. It also grants `authenticated` all four DML privileges on `scheduled_task_runs`; the
rehearsal baseline grants those privileges only on `scheduled_tasks`. Production grants
`service_role` all four DML privileges on both tables; the rehearsal baseline lacks those four on
`scheduled_task_runs`.

For `next_scheduled_task_occurrence(p_previous timestamptz, p_repeat text)`, production contains
explicit `anon`, `authenticated`, and `service_role` execute grants in addition to the existing
`PUBLIC` grant. Effective execution is unchanged, but the normalized ACL differs. The other six
scheduled routines match the rehearsal baseline ACL state.

These differences are evidence, not authorization to alter privileges. The two scheduled-object
lineage candidates remain `requires_schema_proof`.

## Remaining gates

Independent review and exact-head CI are required before merging this promotion. Production
history repair, recovery evidence, release readiness, and production acceptance remain separate
blocked milestones.
