#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
BRANCH="finalization/checkpoint-2026-08-28"
EXPECTED_MIGRATIONS=88

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

# Existing untracked evidence is intentionally preserved. Confirm that the
# tracked checkpoint itself is synchronized before creating the closure commit.
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

ALLOWED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-scheduled-max-allowed.XXXXXX")"
CHANGED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-scheduled-max-changed.XXXXXX")"
STAGED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-scheduled-max-staged.XXXXXX")"
cleanup() { rm -f "$ALLOWED_FILE" "$CHANGED_FILE" "$STAGED_FILE"; }
trap cleanup EXIT

cat >"$ALLOWED_FILE" <<'EOF'
infra/azure/production/main.bicep
infra/azure/staging/main.bicep
release-migrations.json
scripts/azure/template-contract.mjs
scripts/azure/validate-production-template.mjs
scripts/azure/validate-staging-template.mjs
scripts/release/apply-scheduled-azure-v2.mjs
scripts/release/apply-scheduled-product-v2.mjs
scripts/release/apply-scheduled-runtime-activation-v2.mjs
src/components/ScheduledTaskEditor.tsx
src/components/ScheduledTaskHistoryPanel.tsx
src/lib/scheduled-task-history.functions.ts
src/lib/scheduled-tasks.functions.ts
src/routes/scheduled-tasks.tsx
tests/unit/azure-production-template.test.mjs
tests/unit/azure-staging-template.test.mjs
tests/unit/scheduled-azure-v2-source.test.mjs
tests/unit/scheduled-history-retry-v2.test.mjs
tests/unit/scheduled-runtime-activation-v2.test.mjs
EOF
sort -o "$ALLOWED_FILE" "$ALLOWED_FILE"

printf '\n=== 1. APPLY ALL THREE DETERMINISTIC SCHEDULER TRANSFORMS ===\n'
node scripts/release/apply-scheduled-azure-v2.mjs
node scripts/release/apply-scheduled-runtime-activation-v2.mjs
node scripts/release/apply-scheduled-product-v2.mjs

printf '\n=== 2. FORMAT THE OWNED SOURCE ONCE ===\n'
node_modules/.bin/prettier --write \
  scripts/release/apply-scheduled-azure-v2.mjs \
  scripts/release/apply-scheduled-runtime-activation-v2.mjs \
  scripts/release/apply-scheduled-product-v2.mjs \
  scripts/azure/template-contract.mjs \
  scripts/azure/validate-production-template.mjs \
  scripts/azure/validate-staging-template.mjs \
  src/lib/scheduled-tasks.functions.ts \
  src/lib/scheduled-task-history.functions.ts \
  src/components/ScheduledTaskEditor.tsx \
  src/components/ScheduledTaskHistoryPanel.tsx \
  src/routes/scheduled-tasks.tsx \
  tests/unit/azure-production-template.test.mjs \
  tests/unit/azure-staging-template.test.mjs \
  tests/unit/scheduled-azure-v2-source.test.mjs \
  tests/unit/scheduled-history-retry-v2.test.mjs \
  tests/unit/scheduled-runtime-activation-v2.test.mjs

printf '\n=== 3. REGENERATE THE COMPLETE MIGRATION MANIFEST ONCE ===\n'
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
assert.equal(manifest.count, 88);
assert.equal(manifest.migrations.length, 88);
assert.equal(manifest.latest, "20260831211500_scheduled_running_mutations_v2.sql");
console.log("MIGRATION_MANIFEST_88=PASS");
NODE

git diff --check

printf '\n=== 4. PROVE THE MUTATION SCOPE BEFORE STAGING ===\n'
git diff --name-only | sort >"$CHANGED_FILE"
if [ ! -s "$CHANGED_FILE" ]; then
  echo "STOP=NO_SOURCE_CLOSURE_CHANGES"
  exit 1
fi
UNEXPECTED="$(comm -23 "$CHANGED_FILE" "$ALLOWED_FILE")"
if [ -n "$UNEXPECTED" ]; then
  echo "STOP=UNEXPECTED_TRACKED_CHANGES"
  printf '%s\n' "$UNEXPECTED"
  git status --short --branch
  exit 1
fi

# Generated contract tests can already be at the deterministic fixed point.
# They are required and executed by the consolidated verifier, but they
# do not need to appear in the mutation diff.
for required in \
  infra/azure/production/main.bicep \
  infra/azure/staging/main.bicep \
  release-migrations.json \
  scripts/azure/template-contract.mjs \
  src/routes/scheduled-tasks.tsx; do
  grep -qxF "$required" "$CHANGED_FILE" || {
    echo "STOP=EXPECTED_SOURCE_CLOSURE_FILE_NOT_CHANGED:$required"
    cat "$CHANGED_FILE"
    exit 1
  }
done

echo "CHANGE_SCOPE=PASS"
cat "$CHANGED_FILE"

printf '\n=== 5. STAGE ONLY THE APPROVED SOURCE-CLOSURE FILES ===\n'
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

printf '\n=== 6. CREATE ONE LOCAL CLOSURE COMMIT ===\n'
git commit -m "chore: close Scheduled Tasks final source stack [skip actions] [skip ci]"
VERIFY_SHA="$(git rev-parse HEAD)"
printf 'VERIFY_SHA=%s\n' "$VERIFY_SHA"

printf '\n=== 7. RUN ONE CONSOLIDATED FINAL SCHEDULER SOURCE GATE ===\n'
bash scripts/release/verify-scheduled-final-source-max.sh

printf '\n=== 8. PUSH ONLY AFTER THE COMPLETE STACK PASSES ===\n'
git push origin "$BRANCH"

printf '\n=== 9. FINAL STATE ===\n'
git status --short --branch
git log -7 --oneline --decorate

printf '\n============================================================\n'
printf ' KOVAGPT_SCHEDULED_SOURCE_STACK_MAX=PASS\n'
printf ' VERIFIED_SHA=%s\n' "$VERIFY_SHA"
printf ' MIGRATION_COUNT=%s\n' "$MIGRATION_COUNT"
printf ' SCHEDULER_SOURCE_DEFAULT=DISABLED\n'
printf ' SAME_IMAGE_RUNTIME_ACTIVATION=EXPLICIT_GATED_FLAG\n'
printf ' PRODUCTION_MIGRATIONS_APPLIED=0\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' APPLICATION_BUILD_RUN=NO\n'
printf ' WORKER_BUNDLE_BUILD_RUN=YES\n'
printf ' FULL_BROWSER_MATRIX_RUN=NO\n'
printf ' GITHUB_ACTIONS_REQUESTED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
