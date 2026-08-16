# Supabase migration reconciliation and rehearsal plan

## Verified baseline on August 16, 2026

- Intended production project ref: `mfbycmbjygcfkrsuepxf`
- Repository manifest: 72 ordered migrations
- Remote repository migration history: 0
- Remote public application tables: 0
- Remote Auth users: 0
- Remote Auth identities: 0
- Remote Storage buckets and objects: 0
- Current advisor warning: `public.rls_auto_enable()` remains directly executable by `anon` and `authenticated` until the reviewed privilege migration is applied

No production SQL was executed while collecting this evidence.

## Source reconciliation

Run:

```bash
npm run release:migrations
npm run release:migration-preflight
```

The preflight verifies count, ordering, filename timestamps, SHA-256 values, latest migration identity, duplicate-content groups, destructive flags, data backfills, RLS changes, and function changes.

The manifest currently contains an exact-content duplicate for the historical email infrastructure migration. The SQL is expected to be idempotent, but the duplicate must remain visible in the rehearsal evidence rather than being silently discarded or rewriting applied history.

## Rehearsal sequence

1. Create or select an isolated non-production Supabase branch/project.
2. Export its migration history before mutation.
3. Apply the 72-migration chain from a clean database.
4. Re-run the complete chain or reset/reapply to prove deterministic fresh-database behavior.
5. Build a realistic previous-state database and apply only the pending range.
6. Validate tables, constraints, indexes, extensions, triggers, functions, grants, RLS, Storage policies, and `kovagpt_schema_health`.
7. Run the two-user isolation harness and Supabase advisors.
8. Capture exact evidence files for fresh database, upgrade rehearsal, two-user RLS, remote migration history, and backup/recovery.
9. Run `npm run release:migration-preflight:ready` with those evidence paths.

## Hard stops

Production migration is prohibited unless:

- `SUPABASE_PROJECT_REF` explicitly equals the intended target;
- unknown remote migration versions equal zero;
- fresh and upgrade rehearsals pass;
- two-user RLS passes;
- backup/PITR evidence exists;
- auth migration remains not started or has an explicit exactly-once plan;
- `KOVA_PRODUCTION_MIGRATION_APPROVED` exactly equals the target ref at the human approval boundary.

Never rerun a completed auth migration or destructive database command blindly.
