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

BASE_SHA="$(git rev-parse HEAD)"
echo "BASE_SHA=$BASE_SHA"

for tool in prettier eslint tsc vite; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    echo "STOP=MISSING_LOCAL_TOOL_$tool"
    exit 1
  fi
done
command -v node >/dev/null || { echo "STOP=MISSING_NODE"; exit 1; }

ALLOWED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-scheduled-allowed.XXXXXX")"
STAGED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-scheduled-staged.XXXXXX")"
cleanup() { rm -f "$ALLOWED_FILE" "$STAGED_FILE"; }
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

echo
echo "=== 1. APPLY THE THREE DETERMINISTIC FINAL TRANSFORMS ==="
node scripts/release/apply-scheduled-azure-v2.mjs
node scripts/release/apply-scheduled-runtime-activation-v2.mjs
node scripts/release/apply-scheduled-product-v2.mjs

echo
echo "=== 2. FORMAT ONLY SCHEDULER SOURCE OWNED BY THIS BATCH ==="
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

echo
echo "=== 3. REGENERATE THE COMPLETE MIGRATION MANIFEST ONCE ==="
npm run release:manifest

MIGRATION_COUNT="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATIONS" ]; then
  echo "STOP=UNEXPECTED_MIGRATION_COUNT:$MIGRATION_COUNT"
  exit 1
fi

git diff --check

echo
echo "=== 4. STAGE ONLY THE ALLOWED SOURCE-CLOSURE FILES ==="
while IFS= read -r path; do
  if [ -e "$path" ]; then
    git add -- "$path"
  fi
done <"$ALLOWED_FILE"

git diff --cached --name-only | sort >"$STAGED_FILE"
if [ ! -s "$STAGED_FILE" ]; then
  echo "STOP=NO_SOURCE_CLOSURE_CHANGES"
  exit 1
fi
UNEXPECTED="$(comm -23 "$STAGED_FILE" "$ALLOWED_FILE")"
if [ -n "$UNEXPECTED" ]; then
  echo "STOP=UNEXPECTED_STAGED_FILES"
  printf '%s\n' "$UNEXPECTED"
  git diff --cached --name-status
  exit 1
fi

for required in \
  infra/azure/production/main.bicep \
  infra/azure/staging/main.bicep \
  release-migrations.json \
  scripts/azure/template-contract.mjs \
  src/routes/scheduled-tasks.tsx \
  tests/unit/scheduled-azure-v2-source.test.mjs \
  tests/unit/scheduled-history-retry-v2.test.mjs; do
  grep -qxF "$required" "$STAGED_FILE" || {
    echo "STOP=EXPECTED_SOURCE_CLOSURE_FILE_NOT_STAGED:$required"
    cat "$STAGED_FILE"
    exit 1
  }
done

git diff --cached --check

echo "STAGED_SCOPE=PASS"
cat "$STAGED_FILE"

echo
echo "=== 5. CREATE ONE LOCAL SOURCE-CLOSURE COMMIT ==="
git commit -m "chore: close Scheduled Tasks final source stack [skip actions] [skip ci]"
VERIFY_SHA="$(git rev-parse HEAD)"
echo "VERIFY_SHA=$VERIFY_SHA"

echo
echo "=== 6. RUN THE ONE FINAL SCHEDULED TASKS SOURCE GATE ==="
bash scripts/release/verify-scheduled-final-source.sh

echo
echo "=== 7. PUSH ONLY AFTER THE ENTIRE SCHEDULER SOURCE STACK PASSES ==="
git push origin "$BRANCH"

echo
echo "=== 8. FINAL STATE ==="
git status --short --branch
git log -6 --oneline --decorate

echo
echo "============================================================"
echo " KOVAGPT_SCHEDULED_SOURCE_STACK=PASS"
echo " VERIFIED_SHA=$VERIFY_SHA"
echo " MIGRATION_COUNT=$MIGRATION_COUNT"
echo " SCHEDULER_SOURCE_DEFAULT=DISABLED"
echo " RUNTIME_ACTIVATION=EXPLICIT_SAME_IMAGE_FLAG"
echo " PRODUCTION_MIGRATIONS_APPLIED=0"
echo " PROVIDER_LIVE_CALLS=0"
echo " APPLICATION_BUILD_RUN=NO"
echo " WORKER_BUNDLE_BUILD_RUN=YES"
echo " FULL_BROWSER_MATRIX_RUN=NO"
echo " GITHUB_ACTIONS_REQUESTED=0"
echo " AZURE_DEPLOYMENTS=0"
echo " LOVABLE_CREDITS_USED=0"
echo "============================================================"
