#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
[[ $# -eq 1 ]] || { echo "usage: $0 BACKUP_DIRECTORY" >&2; exit 1; }
DIR="$1"
[[ -d "$DIR" ]] || { echo "backup directory not found" >&2; exit 1; }
(
  cd "$DIR"
  shasum -a 256 -c CHECKSUMS.sha256
  for file in roles.sql schema.sql data.sql history-schema.sql history-data.sql MANIFEST.json; do [[ -s "$file" ]]; done
  grep -Eqi 'chat_message_versions|chat_branches|projects|user_library_items' schema.sql
  grep -Eqi 'schema_migrations' history-schema.sql
  node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("MANIFEST.json", "utf8"));
if (!/^[a-z0-9]{20}$/u.test(manifest.projectRef ?? "")) throw new Error("backup project ref is invalid");
if (manifest.storageObjectsIncluded !== false || manifest.storageObjectBackupRequiredSeparately !== true) {
  throw new Error("storage backup limitation is not recorded truthfully");
}
if (manifest.secretsIncluded !== false) throw new Error("backup manifest must state that secrets are excluded");
NODE
)
echo "KOVA_SUPABASE_BACKUP_VERIFICATION=PASS directory=$DIR"
