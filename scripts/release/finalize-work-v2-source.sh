#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
BRANCH="finalization/checkpoint-2026-08-28"
EXPECTED_MIGRATIONS=89

if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  echo "STOP=WRONG_BRANCH"
  git status --short --branch
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=TRACKED_OR_STAGED_CHANGES"
  git status --short --branch
  exit 1
fi

for tool in prettier eslint tsc vite; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    echo "STOP=MISSING_LOCAL_TOOL_$tool"
    exit 1
  fi
done
command -v node >/dev/null || { echo "STOP=MISSING_NODE"; exit 1; }

git fetch origin "$BRANCH"
BASE_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
if [ "$BASE_SHA" != "$REMOTE_SHA" ]; then
  echo "STOP=LOCAL_REMOTE_HEAD_MISMATCH"
  echo "LOCAL_SHA=$BASE_SHA"
  echo "REMOTE_SHA=$REMOTE_SHA"
  exit 1
fi
printf 'BASE_SHA=%s\n' "$BASE_SHA"

ALLOWED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-work-v2-allowed.XXXXXX")"
CHANGED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-work-v2-changed.XXXXXX")"
STAGED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-work-v2-staged.XXXXXX")"
cleanup() { rm -f "$ALLOWED_FILE" "$CHANGED_FILE" "$STAGED_FILE"; }
trap cleanup EXIT

cat >"$ALLOWED_FILE" <<'EOF'
package.json
release-migrations.json
scripts/release/apply-work-v2-source.mjs
src/lib/work-execution-v2.server.ts
src/workers/work-v2-runner.ts
src/workers/work-v2.ts
tests/unit/scheduled-worker-build-v2.test.mjs
tests/unit/work-execution-v2-engine.test.mjs
tests/unit/work-execution-v2-schema.test.mjs
tests/unit/work-worker-build-v2.test.mjs
tests/unit/work-worker-v2.test.mjs
vite.work-worker.config.ts
EOF
sort -o "$ALLOWED_FILE" "$ALLOWED_FILE"

printf '\n=== 1. APPLY THE DETERMINISTIC WORK V2 INTEGRATION ===\n'
node scripts/release/apply-work-v2-source.mjs

printf '\n=== 2. FORMAT THE OWNED SOURCE ONCE ===\n'
node_modules/.bin/prettier --write \
  package.json \
  scripts/release/apply-work-v2-source.mjs \
  src/lib/work-execution-v2.server.ts \
  src/workers/work-v2-runner.ts \
  src/workers/work-v2.ts \
  tests/unit/scheduled-worker-build-v2.test.mjs \
  tests/unit/work-execution-v2-engine.test.mjs \
  tests/unit/work-execution-v2-schema.test.mjs \
  tests/unit/work-worker-build-v2.test.mjs \
  tests/unit/work-worker-v2.test.mjs \
  vite.work-worker.config.ts

printf '\n=== 3. REGENERATE THE 89-MIGRATION MANIFEST ONCE ===\n'
npm run release:manifest
node_modules/.bin/prettier --write release-migrations.json

MIGRATION_COUNT="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATIONS" ]; then
  echo "STOP=UNEXPECTED_MIGRATION_COUNT:$MIGRATION_COUNT"
  exit 1
fi
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("release-migrations.json", "utf8"));
assert.equal(manifest.count, 89);
assert.equal(manifest.migrations.length, 89);
assert.equal(manifest.latest, "20260901010000_work_execution_v2.sql");
console.log("MIGRATION_MANIFEST_89=PASS");
NODE

git diff --check

printf '\n=== 4. PROVE THE MUTATION SCOPE ===\n'
git diff --name-only | sort >"$CHANGED_FILE"
if [ ! -s "$CHANGED_FILE" ]; then
  echo "STOP=NO_WORK_V2_CLOSURE_CHANGES"
  exit 1
fi
UNEXPECTED="$(comm -23 "$CHANGED_FILE" "$ALLOWED_FILE")"
if [ -n "$UNEXPECTED" ]; then
  echo "STOP=UNEXPECTED_TRACKED_CHANGES"
  printf '%s\n' "$UNEXPECTED"
  git status --short --branch
  exit 1
fi

for required in \
  package.json \
  release-migrations.json \
  src/lib/work-execution-v2.server.ts \
  tests/unit/scheduled-worker-build-v2.test.mjs; do
  grep -qxF "$required" "$CHANGED_FILE" || {
    echo "STOP=EXPECTED_WORK_V2_FILE_NOT_CHANGED:$required"
    cat "$CHANGED_FILE"
    exit 1
  }
done

echo "CHANGE_SCOPE=PASS"
cat "$CHANGED_FILE"

printf '\n=== 5. STAGE ONLY THE APPROVED CLOSURE FILES ===\n'
while IFS= read -r path; do
  if [ -e "$path" ]; then
    git add -- "$path"
  fi
done <"$ALLOWED_FILE"

git diff --cached --name-only | sort >"$STAGED_FILE"
if [ ! -s "$STAGED_FILE" ]; then
  echo "STOP=NOTHING_STAGED"
  exit 1
fi
UNEXPECTED_STAGED="$(comm -23 "$STAGED_FILE" "$ALLOWED_FILE")"
if [ -n "$UNEXPECTED_STAGED" ]; then
  echo "STOP=UNEXPECTED_STAGED_FILES"
  printf '%s\n' "$UNEXPECTED_STAGED"
  git diff --cached --name-status
  exit 1
fi
if [ "$(cat "$STAGED_FILE")" != "$(cat "$CHANGED_FILE")" ]; then
  echo "STOP=STAGED_SCOPE_DOES_NOT_MATCH_TRACKED_SCOPE"
  echo "CHANGED:"
  cat "$CHANGED_FILE"
  echo "STAGED:"
  cat "$STAGED_FILE"
  exit 1
fi

git diff --cached --check
echo "STAGED_SCOPE=PASS"

printf '\n=== 6. CREATE ONE LOCAL WORK V2 CLOSURE COMMIT ===\n'
git commit -m "chore: finalize Work execution v2 source foundation [skip actions] [skip ci]"
VERIFY_SHA="$(git rev-parse HEAD)"
printf 'VERIFY_SHA=%s\n' "$VERIFY_SHA"

printf '\n=== 7. RUN ONE CONSOLIDATED ZERO-COST WORK V2 GATE ===\n'
bash scripts/release/verify-work-v2-source.sh

printf '\n=== 8. PUSH ONLY AFTER THE COMPLETE STACK PASSES ===\n'
git push origin "$BRANCH"

printf '\n=== 9. FINAL STATE ===\n'
git status --short --branch
git log -8 --oneline --decorate

printf '\n============================================================\n'
printf ' KOVAGPT_WORK_V2_SOURCE_FOUNDATION=PASS\n'
printf ' VERIFIED_SHA=%s\n' "$VERIFY_SHA"
printf ' MIGRATION_COUNT=%s\n' "$MIGRATION_COUNT"
printf ' WORK_RUNTIME_DEFAULT=DISABLED\n'
printf ' WORK_UI=HISTORY_ONLY\n'
printf ' MODEL_ONLY_WORKER=SOURCE_VERIFIED\n'
printf ' TOOL_EXECUTION=FAIL_CLOSED\n'
printf ' MANAGED_IDENTITY_ONLY=SOURCE_VERIFIED\n'
printf ' PRODUCTION_MIGRATIONS_APPLIED=0\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' APPLICATION_BUILD_RUN=NO\n'
printf ' WORKER_BUNDLE_BUILD_RUN=YES\n'
printf ' FULL_BROWSER_MATRIX_RUN=NO\n'
printf ' GITHUB_ACTIONS_REQUESTED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
