#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v npx >/dev/null || fail "npx is required"
command -v docker >/dev/null || fail "Docker is required by Supabase db dump"
docker info >/dev/null || fail "Docker is not running"
[[ "${KOVA_SUPABASE_BACKUP_CONFIRMATION:-}" == "BACKUP PRODUCTION" ]] || fail "set KOVA_SUPABASE_BACKUP_CONFIRMATION='BACKUP PRODUCTION'"
[[ "${KOVA_EXPECTED_SUPABASE_PROJECT_REF:-}" =~ ^[a-z0-9]{20}$ ]] || fail "KOVA_EXPECTED_SUPABASE_PROJECT_REF must identify production"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${KOVA_SUPABASE_BACKUP_DIR:-artifacts/release/supabase-backup-${STAMP}}"
mkdir -p "$OUT"
SUPABASE=(npx --no-install supabase)

"${SUPABASE[@]}" db dump --linked --file "$OUT/roles.sql" --role-only
"${SUPABASE[@]}" db dump --linked --file "$OUT/schema.sql"
"${SUPABASE[@]}" db dump --linked --file "$OUT/data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
"${SUPABASE[@]}" db dump --linked --file "$OUT/history-schema.sql" --schema supabase_migrations
"${SUPABASE[@]}" db dump --linked --file "$OUT/history-data.sql" --use-copy --data-only --schema supabase_migrations

for file in roles.sql schema.sql data.sql history-schema.sql history-data.sql; do
  [[ -s "$OUT/$file" ]] || fail "$file is empty"
done
(
  cd "$OUT"
  shasum -a 256 roles.sql schema.sql data.sql history-schema.sql history-data.sql > CHECKSUMS.sha256
)
node --input-type=module - "$OUT" "$KOVA_EXPECTED_SUPABASE_PROJECT_REF" <<'NODE'
import { statSync, writeFileSync } from "node:fs";
const [out, projectRef] = process.argv.slice(2);
const files = ["roles.sql", "schema.sql", "data.sql", "history-schema.sql", "history-data.sql"];
writeFileSync(`${out}/MANIFEST.json`, `${JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  source: "linked-production-supabase",
  projectRef,
  files: Object.fromEntries(files.map((file) => [file, { bytes: statSync(`${out}/${file}`).size }])),
  storageObjectsIncluded: false,
  storageObjectBackupRequiredSeparately: true,
  secretsIncluded: false,
}, null, 2)}\n`);
NODE

echo "KOVA_SUPABASE_PRODUCTION_BACKUP=PASS directory=$OUT"
