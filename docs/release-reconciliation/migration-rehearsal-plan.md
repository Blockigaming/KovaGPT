# Supabase migration reconciliation and rehearsal plan

## Production-lineage gate

Read-only evidence captured against production on 2026-09-06 found 98 remote migration-ledger
rows while source commit 21e2a300ada52e3b8e9a50dd4654fd59f15c41b2 contained 93 migration
files. This historical snapshot is drift evidence, not permission to run a migration push or proof
for a later source commit.

`release-migration-lineage.json` inventories every observed remote-only version. It proves only
five remote rows equivalent to three source migrations; the remaining 19 entries are explicitly
marked `requires_schema_proof`. The preflight's ready mode now requires this file and fails closed
until every remote row is either an exact equivalence or proven by an isolated schema, ACL, RLS, and
function-fingerprint rehearsal. It never repairs history or applies DDL.

Ready mode requires a reviewed remote-history export that includes the target project ref, an exact
migration count, and a complete migrations array. The target, count, and remote-only version
inventory must match the lineage capture exactly. An empty entries array is valid only for a target
whose remote history has no remote-only migrations. A truncated, stale, empty, or wrong-target
export cannot clear the gate.

An equivalent mapping also requires its source version to be present in remote history after a
human-authorized history repair. A schema_proven mapping requires a separate
KOVA_MIGRATION_SCHEMA_PROOF_FILE with matching normalized schema, ACL, RLS, and function
fingerprints. The proof file records its target, observed remote count, remote version, source
versions, and equal source/remote SHA-256 fingerprints for all four categories.

For a reviewed rehearsal target, provide KOVA_REMOTE_MIGRATION_FILE and
KOVA_MIGRATION_LINEAGE_FILE, plus KOVA_MIGRATION_SCHEMA_PROOF_FILE when the lineage contains
schema_proven entries, then run npm run release:migration-preflight:ready. A different production
or staging target needs its own reviewed lineage capture; copying this file or a proof is not
evidence.

## Historical baseline on August 16, 2026

- Intended production project ref: `mfbycmbjygcfkrsuepxf`
- Capture-point release branch: 73 ordered SQL migrations after project-invite acceptance hardening
- Capture-point generated manifest: temporarily stale at 72 until the final local generation pass ran npm run release:manifest
- Remote repository migration history: 0
- Remote public application tables: 0
- Remote Auth users: 0
- Remote Auth identities: 0
- Remote Storage buckets and objects: 0
- Current advisor warning: `public.rls_auto_enable()` remains directly executable by `anon` and `authenticated` until the reviewed privilege migration is applied

No production SQL was executed while collecting this evidence.

## Source reconciliation

Run, in this order:

```bash
npm run release:manifest
npm run release:migrations
npm run release:migration-preflight
npm run release:rls:two-user:dry
```

The manifest generator must add `20260816213000_project_invite_acceptance_hardening.sql`, refresh the total to 73, and record its exact SHA-256/classification. The preflight verifies count, ordering, filename timestamps, SHA-256 values, latest migration identity, duplicate-content groups, destructive flags, data backfills, RLS changes, and function changes.

The history contains an exact-content duplicate for the two historical email-infrastructure migrations. The SQL is expected to be idempotent, but the duplicate remains visible in rehearsal evidence rather than silently discarding or rewriting migration history.

## Rehearsal sequence

1. Create or select an isolated non-production Supabase branch/project.
2. Export its migration history before mutation.
3. Apply the exact generated migration chain for the reviewed source commit from a clean database.
4. Reset/reapply or recreate the branch and repeat to prove deterministic fresh-database behavior.
5. Build a realistic previous-state database and apply only the pending range.
6. Validate tables, constraints, indexes, extensions, triggers, functions, grants, RLS, Storage policies, and `kovagpt_schema_health`.
7. Run the complete 14-table two-user isolation harness and Supabase advisors.
8. Verify the invite-acceptance functions require a confirmed recipient email and cannot be executed by public/anon directly.
9. Capture exact evidence files for fresh database, upgrade rehearsal, two-user RLS, remote migration history, normalized schema proof where applicable, and backup/recovery.
10. Supply KOVA_REMOTE_MIGRATION_FILE, KOVA_MIGRATION_LINEAGE_FILE, and a schema-proof file for any schema_proven entries, then run npm run release:migration-preflight:ready.

## Hard stops

Production migration is prohibited unless:

- the generated manifest is current and clean;
- SUPABASE_PROJECT_REF explicitly equals the intended target;
- the target-bound remote export count and remote-only inventory exactly match the reviewed lineage;
- every equivalent or schema-proven mapping has its referenced source version recorded in remote history after approved repair;
- every inventoried remote version is either content-equivalent or has matching external schema/ACL/RLS/function proof;
- fresh and upgrade rehearsals pass;
- all 14 two-user RLS fixtures pass and clean up;
- backup/PITR evidence exists;
- auth migration remains not started or has an explicit exactly-once plan;
- `KOVA_PRODUCTION_MIGRATION_APPROVED` exactly equals the target ref at the human approval boundary.

Never rerun a completed auth migration or destructive database command blindly.
