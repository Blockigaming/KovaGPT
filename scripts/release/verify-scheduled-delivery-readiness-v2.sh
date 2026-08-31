#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
EXPECTED_BRANCH="finalization/checkpoint-2026-08-28"
if [ "$(git branch --show-current)" != "$EXPECTED_BRANCH" ]; then
  echo "STOP=WRONG_BRANCH"
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=TRACKED_OR_STAGED_CHANGES"
  git status --short --branch
  exit 1
fi

SOURCE_SHA="$(git rev-parse HEAD)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-scheduled-delivery-readiness.XXXXXX")"
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 20 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 260 "$LOG_DIR/$name.log"
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

for tool in eslint prettier tsc vite; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    printf 'STOP=MISSING_LOCAL_TOOL_%s\n' "$tool"
    exit 1
  fi
done

FILES=(
  src/lib/scheduled-delivery-v2.server.ts
  src/workers/scheduled-v2-runner.ts
  src/workers/scheduled-v2.ts
  tests/unit/scheduled-delivery-observability-v2.test.mjs
  tests/unit/scheduled-delivery-v2-engine.test.mjs
  tests/unit/scheduled-worker-v2.test.mjs
)

gate delivery-schema-syntax node --check tests/unit/scheduled-delivery-observability-v2.test.mjs
gate delivery-engine-syntax node --check tests/unit/scheduled-delivery-v2-engine.test.mjs
gate worker-test-syntax node --check tests/unit/scheduled-worker-v2.test.mjs
gate targeted-format node_modules/.bin/prettier --check "${FILES[@]}"
gate targeted-lint node_modules/.bin/eslint "${FILES[@]}"
gate migration-contract node scripts/release/migrations.mjs

gate scheduler-delivery-tests node --test \
  tests/unit/scheduled-delivery-observability-v2.test.mjs \
  tests/unit/scheduled-delivery-v2-engine.test.mjs \
  tests/unit/scheduled-worker-v2.test.mjs \
  tests/unit/scheduled-time-semantics-v2.test.mjs \
  tests/unit/scheduled-worker-build-v2.test.mjs \
  tests/unit/scheduled-execution-v2-schema.test.mjs \
  tests/unit/scheduled-execution-v2-engine.test.mjs \
  tests/unit/scheduled-batch-safety.test.mjs

gate typecheck node_modules/.bin/tsc --noEmit
gate scheduled-worker-build npm run build:scheduled-worker

if [ ! -s dist/worker/scheduled-v2.mjs ]; then
  echo "STOP=SCHEDULED_WORKER_BUNDLE_MISSING"
  exit 1
fi
gate scheduled-worker-bundle-syntax node --check dist/worker/scheduled-v2.mjs

set +e
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production \
  node dist/worker/scheduled-v2.mjs >"$LOG_DIR/fail-closed-bundle.log" 2>&1
FAIL_CLOSED_CODE=$?
set -e
if [ "$FAIL_CLOSED_CODE" -eq 0 ]; then
  echo "STOP=SCHEDULED_WORKER_BUNDLE_DID_NOT_FAIL_CLOSED"
  cat "$LOG_DIR/fail-closed-bundle.log"
  exit 1
fi
if grep -Eqi 'Missing Supabase|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|AZURE_OPENAI_API_KEY' \
  "$LOG_DIR/fail-closed-bundle.log"; then
  echo "STOP=SCHEDULED_WORKER_TOUCHED_SECRETS_WHILE_DISABLED"
  cat "$LOG_DIR/fail-closed-bundle.log"
  exit 1
fi
printf 'scheduled-worker-fail-closed=PASS\n'
tail -n 8 "$LOG_DIR/fail-closed-bundle.log"

grep -nF 'export const scheduledExecutionAvailable = false;' \
  src/lib/scheduled-tasks.functions.ts >"$LOG_DIR/product-fail-closed.log"

git diff --check
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=VALIDATION_CHANGED_TRACKED_FILES"
  git status --short --branch
  exit 1
fi

printf '\n============================================================\n'
printf ' KOVAGPT_SCHEDULED_DELIVERY_READINESS_V2_SOURCE=PASS\n'
printf ' SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf ' MIGRATION_COUNT=86\n'
printf ' IN_APP_DELIVERY=SOURCE_VERIFIED\n'
printf ' READINESS_METRICS=SOURCE_VERIFIED\n'
printf ' STALE_WORKER_DETECTION=SOURCE_VERIFIED\n'
printf ' EMAIL_DELIVERY=NOT_ENABLED\n'
printf ' SCHEDULER_ENABLED=NO\n'
printf ' SCHEMA_APPLIED_TO_PRODUCTION=NO\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' APP_BUILD_RUN=NO\n'
printf ' WORKER_BUNDLE_BUILD_RUN=YES\n'
printf ' BROWSER_MATRIX_RUN=NO\n'
printf ' LEDGER_PROMOTED=NO\n'
printf ' GITHUB_ACTIONS_DISPATCHED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
