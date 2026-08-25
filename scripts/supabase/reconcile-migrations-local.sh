#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null || fail "node is required"
command -v npx >/dev/null || fail "npx is required"
[[ -d supabase/migrations ]] || fail "run from the KovaGPT repository root"
mkdir -p artifacts/release

SUPABASE=(npx --no-install supabase)
MODE="${1:---check}"
case "$MODE" in
  --check)
    "${SUPABASE[@]}" migration list --linked | tee artifacts/release/supabase-migration-list.txt
    echo "No migration history was changed. Use --fetch only after reviewing the list."
    ;;
  --fetch)
    command -v git >/dev/null || fail "git is required"
    [[ -z "$(git status --porcelain)" ]] || fail "repository must be clean before fetching migrations"
    BEFORE="$(mktemp -d)"
    cp -R supabase/migrations "$BEFORE/migrations"
    restore_local() {
      rm -rf supabase/migrations
      cp -R "$BEFORE/migrations" supabase/migrations
    }
    trap 'rm -rf "$BEFORE"' EXIT
    "${SUPABASE[@]}" migration fetch --linked
    "${SUPABASE[@]}" migration list --linked | tee artifacts/release/supabase-migration-list.txt
    if ! node --input-type=module - artifacts/release/supabase-migration-list.txt <<'NODE'
import { readFileSync } from "node:fs";
const text = readFileSync(process.argv[2], "utf8");
const rows = text.split(/\r?\n/u).map((line) => line.split("|").map((cell) => cell.trim()));
const drift = rows
  .filter((cells) => cells.length >= 2)
  .map(([local, remote]) => ({ local: /^\d{14}$/u.test(local) ? local : "", remote: /^\d{14}$/u.test(remote) ? remote : "" }))
  .filter(({ local, remote }) => Boolean(local) !== Boolean(remote));
if (drift.length) {
  console.error(JSON.stringify({ drift }, null, 2));
  process.exit(1);
}
NODE
    then
      restore_local
      fail "migration fetch did not fully reconcile history; local files were restored"
    fi
    echo "KOVA_SUPABASE_MIGRATION_FETCH=PASS"
    ;;
  *) fail "usage: $0 [--check|--fetch]" ;;
esac
