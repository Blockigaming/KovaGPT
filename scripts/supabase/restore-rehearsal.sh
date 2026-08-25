#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
[[ $# -eq 1 ]] || fail "usage: $0 BACKUP_DIRECTORY"
DIR="$1"
[[ -d "$DIR" ]] || fail "backup directory not found"
: "${KOVA_SUPABASE_RESTORE_TARGET_DB_URL:?KOVA_SUPABASE_RESTORE_TARGET_DB_URL is required}"
: "${KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF:?KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF is required}"
[[ "${KOVA_SUPABASE_RESTORE_CONFIRMATION:-}" == "RESTORE DISPOSABLE $KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF" ]] || fail "set KOVA_SUPABASE_RESTORE_CONFIRMATION='RESTORE DISPOSABLE $KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF'"
[[ "${KOVA_SUPABASE_RESTORE_TARGET_IS_DISPOSABLE:-}" == "1" ]] || fail "target must be explicitly marked disposable"
[[ "$KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "restore target project ref is invalid"
[[ "$KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF" != "${KOVA_EXPECTED_SUPABASE_PROJECT_REF:-}" ]] || fail "refusing to restore into the production project"
command -v psql >/dev/null || fail "psql is required"
"$(dirname "$0")/verify-backup.sh" "$DIR"

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$DIR/roles.sql" \
  --file "$DIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$DIR/data.sql" \
  --file "$DIR/history-schema.sql" \
  --file "$DIR/history-data.sql" \
  --dbname "$KOVA_SUPABASE_RESTORE_TARGET_DB_URL"

psql --variable ON_ERROR_STOP=1 --dbname "$KOVA_SUPABASE_RESTORE_TARGET_DB_URL" <<'SQL'
DO $$
DECLARE missing text[];
BEGIN
  SELECT array_agg(name) INTO missing
  FROM (VALUES
    ('chat_message_versions'),
    ('chat_branches'),
    ('chat_pinned_files'),
    ('chat_custom_rules'),
    ('projects'),
    ('user_library_items')
  ) AS required(name)
  WHERE to_regclass('public.' || name) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'missing restored tables: %', missing; END IF;
END $$;
DO $$
DECLARE insecure text[];
BEGIN
  SELECT array_agg(c.relname) INTO insecure
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('chat_message_versions','chat_branches','chat_pinned_files','chat_custom_rules','projects','user_library_items')
    AND NOT c.relrowsecurity;
  IF insecure IS NOT NULL THEN RAISE EXCEPTION 'RLS disabled after restore: %', insecure; END IF;
END $$;
SELECT count(*) >= 1 AS migration_history_present FROM supabase_migrations.schema_migrations;
SQL

echo "KOVA_SUPABASE_RESTORE_REHEARSAL=PASS target=$KOVA_SUPABASE_RESTORE_TARGET_PROJECT_REF"
