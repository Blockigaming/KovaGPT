# Supabase migration reconciliation and rehearsal plan

## Verified baseline on August 16, 2026

- Intended production project ref: `mfbycmbjygcfkrsuepxf`
- Current release branch: 73 ordered SQL migrations after project-invite acceptance hardening
- Committed generated manifest: temporarily stale at 72 until the final local generation pass runs `npm run release:manifest`
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
3. Apply the 73-migration chain from a clean database.
4. Reset/reapply or recreate the branch and repeat to prove deterministic fresh-database behavior.
5. Build a realistic previous-state database and apply only the pending range.
6. Validate tables, constraints, indexes, extensions, triggers, functions, grants, RLS, Storage policies, and `kovagpt_schema_health`.
7. Run the complete 14-table two-user isolation harness and Supabase advisors.
8. Verify the invite-acceptance functions require a confirmed recipient email and cannot be executed by public/anon directly.
9. Capture exact evidence files for fresh database, upgrade rehearsal, two-user RLS, remote migration history, and backup/recovery.
10. Run `npm run release:migration-preflight:ready` with those evidence paths.

## Hard stops

Production migration is prohibited unless:

- the generated manifest is current and clean;
- `SUPABASE_PROJECT_REF` explicitly equals the intended target;
- unknown remote migration versions equal zero;
- fresh and upgrade rehearsals pass;
- all 14 two-user RLS fixtures pass and clean up;
- backup/PITR evidence exists;
- auth migration remains not started or has an explicit exactly-once plan;
- `KOVA_PRODUCTION_MIGRATION_APPROVED` exactly equals the target ref at the human approval boundary.

Never rerun a completed auth migration or destructive database command blindly.
