# Supabase production migration, backup, and recovery

## Migration history

Use `npm run supabase:migrations:check` first. If remote-only migrations exist, use `npm run supabase:migrations:fetch` from a clean repository. The fetch wrapper backs up local migrations and restores them if drift remains. It never runs `migration repair`; applied/reverted ledger changes require human review and independent schema evidence.

## Backup

`KOVA_SUPABASE_BACKUP_CONFIRMATION='BACKUP PRODUCTION' npm run supabase:backup:production` creates roles, schema, data, and migration-history dumps plus SHA-256 checksums and a manifest. Storage object bytes are not included in the database dump and require a separate Storage export/replication procedure.

Verify a backup with:

```bash
npm run supabase:backup:verify -- artifacts/release/supabase-backup-<timestamp>
```

## Restore rehearsal

Restore only into a disposable, isolated database. Set `KOVA_SUPABASE_RESTORE_TARGET_DB_URL`, `KOVA_SUPABASE_RESTORE_TARGET_IS_DISPOSABLE=1`, and the exact confirmation before running `npm run supabase:restore:rehearsal -- <backup-directory>`. The rehearsal verifies critical tables and migration history after restore.

## Authorization evidence

The production release requires the existing two-user RLS verifier to prove owner access and cross-user denial for all critical user-scoped tables. A schema listing or RLS policy text alone is not sufficient evidence.
