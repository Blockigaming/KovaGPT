#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
EXPECTED_BRANCH="finalization/checkpoint-2026-08-28"
EXPECTED_MIGRATIONS=88

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
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-scheduled-final-max.XXXXXX")"
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 32 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 320 "$LOG_DIR/$name.log"
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

for tool in eslint prettier tsc vite; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    echo "STOP=MISSING_LOCAL_TOOL_$tool"
    exit 1
  fi
done
command -v node >/dev/null || { echo "STOP=MISSING_NODE"; exit 1; }

SHELL_FILES=(
  scripts/release/finalize-scheduled-source.sh
  scripts/release/finalize-scheduled-source-max.sh
  scripts/release/verify-scheduled-final-source.sh
  scripts/release/verify-scheduled-final-source-max.sh
  scripts/azure/verify-scheduled-job-local.sh
)

FORMAT_FILES=(
  scripts/release/apply-scheduled-azure-v2.mjs
  scripts/release/apply-scheduled-runtime-activation-v2.mjs
  scripts/release/apply-scheduled-product-v2.mjs
  scripts/azure/template-contract.mjs
  scripts/azure/validate-production-template.mjs
  scripts/azure/validate-staging-template.mjs
  src/lib/scheduled-execution-v2.server.ts
  src/lib/scheduled-delivery-v2.server.ts
  src/lib/scheduled-tasks.functions.ts
  src/lib/scheduled-task-history.functions.ts
  src/workers/scheduled-v2-runner.ts
  src/workers/scheduled-v2.ts
  src/components/ScheduledTaskEditor.tsx
  src/components/ScheduledTaskHistoryPanel.tsx
  src/routes/scheduled-tasks.tsx
  vite.scheduled-worker.config.ts
  tests/unit/azure-production-template.test.mjs
  tests/unit/azure-staging-template.test.mjs
  tests/unit/scheduled-azure-v2-source.test.mjs
  tests/unit/scheduled-history-retry-v2.test.mjs
  tests/unit/scheduled-runtime-activation-v2.test.mjs
  tests/unit/scheduled-batch-safety.test.mjs
  tests/unit/scheduled-execution-v2-schema.test.mjs
  tests/unit/scheduled-execution-v2-engine.test.mjs
  tests/unit/scheduled-time-semantics-v2.test.mjs
  tests/unit/scheduled-worker-build-v2.test.mjs
  tests/unit/scheduled-worker-v2.test.mjs
  tests/unit/scheduled-delivery-observability-v2.test.mjs
  tests/unit/scheduled-delivery-v2-engine.test.mjs
)

for file in "${SHELL_FILES[@]}" "${FORMAT_FILES[@]}"; do
  [ -f "$file" ] || { echo "STOP=MISSING_FINAL_SCHEDULER_FILE:$file"; exit 1; }
done

MIGRATION_COUNT="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATIONS" ]; then
  echo "STOP=UNEXPECTED_MIGRATION_COUNT:$MIGRATION_COUNT"
  exit 1
fi

# Shell files use the shell parser. Prettier and ESLint are intentionally
# restricted to the JavaScript/TypeScript source they support.
gate shell-syntax bash -c '
  for file in "$@"; do
    bash -n "$file"
  done
' bash "${SHELL_FILES[@]}"

# The complete committed scheduler source must be the fixed point of all three
# deterministic transforms, including same-image runtime activation.
gate transform-idempotence bash -c '
  node scripts/release/apply-scheduled-azure-v2.mjs &&
  node scripts/release/apply-scheduled-runtime-activation-v2.mjs &&
  node scripts/release/apply-scheduled-product-v2.mjs &&
  node_modules/.bin/prettier --write \
    tests/unit/scheduled-azure-v2-source.test.mjs \
    tests/unit/scheduled-history-retry-v2.test.mjs \
    tests/unit/scheduled-runtime-activation-v2.test.mjs
'
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=TRANSFORM_NOT_IDEMPOTENT"
  git status --short --branch
  git diff --stat
  exit 1
fi

gate targeted-format node_modules/.bin/prettier --check "${FORMAT_FILES[@]}"
gate targeted-lint node_modules/.bin/eslint "${FORMAT_FILES[@]}"
gate migration-contract node scripts/release/migrations.mjs
gate migration-preflight node scripts/release/migration-preflight.mjs --source-only
gate production-template node scripts/azure/validate-production-template.mjs
gate staging-template node scripts/azure/validate-staging-template.mjs

SCHEDULER_TESTS=(
  tests/unit/azure-production-template.test.mjs
  tests/unit/azure-staging-template.test.mjs
  tests/unit/scheduled-azure-v2-source.test.mjs
  tests/unit/scheduled-history-retry-v2.test.mjs
  tests/unit/scheduled-runtime-activation-v2.test.mjs
  tests/unit/scheduled-batch-safety.test.mjs
  tests/unit/scheduled-execution-v2-schema.test.mjs
  tests/unit/scheduled-execution-v2-engine.test.mjs
  tests/unit/scheduled-time-semantics-v2.test.mjs
  tests/unit/scheduled-worker-build-v2.test.mjs
  tests/unit/scheduled-worker-v2.test.mjs
  tests/unit/scheduled-delivery-observability-v2.test.mjs
  tests/unit/scheduled-delivery-v2-engine.test.mjs
)
for candidate in tests/unit/*day14*scheduled*.test.mjs tests/integration/*scheduled*.test.mjs tests/integration/*day14*.test.mjs; do
  if [ -f "$candidate" ]; then
    SCHEDULER_TESTS+=("$candidate")
  fi
done

gate scheduler-source-tests node --test "${SCHEDULER_TESTS[@]}"
gate typecheck node_modules/.bin/tsc --noEmit
gate scheduled-worker-build npm run build:scheduled-worker

if [ ! -s dist/worker/scheduled-v2.mjs ]; then
  echo "STOP=SCHEDULED_WORKER_BUNDLE_MISSING"
  exit 1
fi
if find dist/worker -type f -name '*.map' -print -quit | grep -q .; then
  echo "STOP=SCHEDULED_WORKER_SOURCE_MAP_PRESENT"
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

if command -v az >/dev/null 2>&1; then
  gate bicep-module az bicep build --file infra/azure/modules/scheduled-worker-job.bicep --stdout
  gate bicep-production az bicep build --file infra/azure/production/main.bicep --stdout
  gate bicep-staging az bicep build --file infra/azure/staging/main.bicep --stdout
  BICEP_COMPILE=PASS
else
  BICEP_COMPILE=SKIPPED_NO_AZURE_CLI
fi

for template in infra/azure/production/main.bicep infra/azure/staging/main.bicep; do
  grep -qF "module scheduledWorker '../modules/scheduled-worker-job.bicep' = if (deployScheduledJob)" "$template" || {
    echo "STOP=SCHEDULER_MODULE_MISSING:$template"
    exit 1
  }
  grep -qF "param scheduledTasksEnabled bool = false" "$template" || {
    echo "STOP=SCHEDULED_RUNTIME_DEFAULT_MISSING:$template"
    exit 1
  }
  grep -qF "name: 'KOVA_SCHEDULED_TASKS_ENABLED'" "$template" || {
    echo "STOP=SCHEDULED_RUNTIME_ENV_MISSING:$template"
    exit 1
  }
  grep -qF "value: scheduledTasksEnabled && deployScheduledJob && generationEnabled ? '1' : '0'" "$template" || {
    echo "STOP=SCHEDULED_RUNTIME_GUARD_INCOMPLETE:$template"
    exit 1
  }
done

if grep -Eq "var schedulerScript = '''|KOVA_SCHEDULED_EXECUTION_ENDPOINT" \
  infra/azure/production/main.bicep infra/azure/staging/main.bicep; then
  echo "STOP=OBSOLETE_AZURE_HTTP_SCHEDULER_PRESENT"
  exit 1
fi
grep -qF "'dist/worker/scheduled-v2.mjs'" infra/azure/modules/scheduled-worker-job.bicep || {
  echo "STOP=DEDICATED_WORKER_ENTRY_MISSING"
  exit 1
}
grep -qF "Microsoft.Insights/scheduledQueryRules@2023-12-01" \
  infra/azure/modules/scheduled-worker-job.bicep || {
  echo "STOP=SCHEDULER_ALERT_RULES_MISSING"
  exit 1
}
grep -qF 'export const scheduledExecutionAvailable = false;' \
  src/lib/scheduled-tasks.functions.ts || {
  echo "STOP=PRODUCT_SOURCE_DEFAULT_LOST"
  exit 1
}
grep -qF 'export function scheduledExecutionRuntimeAvailable' \
  src/lib/scheduled-tasks.functions.ts || {
  echo "STOP=RUNTIME_ACTIVATION_HELPER_MISSING"
  exit 1
}
grep -qF 'process.env.KOVA_SCHEDULED_TASKS_ENABLED' \
  src/lib/scheduled-tasks.functions.ts || {
  echo "STOP=RUNTIME_ACTIVATION_ENV_MISSING"
  exit 1
}
grep -qF 'scheduledExecutionRuntimeAvailable' \
  src/lib/scheduled-task-history.functions.ts || {
  echo "STOP=HISTORY_RUNTIME_GUARD_MISSING"
  exit 1
}

git diff --check
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=VALIDATION_CHANGED_TRACKED_FILES"
  git status --short --branch
  exit 1
fi

printf '\n============================================================\n'
printf ' KOVAGPT_SCHEDULED_FINAL_SOURCE_MAX=PASS\n'
printf ' SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf ' MIGRATION_COUNT=%s\n' "$MIGRATION_COUNT"
printf ' SCHEDULED_EXECUTION_V2=SOURCE_VERIFIED\n'
printf ' TIMEZONE_DST_MISSED_RUNS=SOURCE_VERIFIED\n'
printf ' DEDICATED_WORKER=SOURCE_VERIFIED\n'
printf ' IN_APP_DELIVERY=SOURCE_VERIFIED\n'
printf ' HISTORY_EDIT_MANUAL_RETRY=SOURCE_VERIFIED\n'
printf ' RUNNING_MUTATION_FENCING=SOURCE_VERIFIED\n'
printf ' READINESS_METRICS=SOURCE_VERIFIED\n'
printf ' SCHEDULER_ALERTS=SOURCE_VERIFIED\n'
printf ' AZURE_JOB_WIRING=SOURCE_VERIFIED\n'
printf ' SAME_IMAGE_RUNTIME_ACTIVATION=SOURCE_VERIFIED\n'
printf ' SOURCE_DEFAULT=DISABLED\n'
printf ' BICEP_COMPILE=%s\n' "$BICEP_COMPILE"
printf ' EMAIL_DELIVERY=NOT_ENABLED\n'
printf ' PRODUCTION_MIGRATIONS_APPLIED=0\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' APPLICATION_BUILD_RUN=NO\n'
printf ' WORKER_BUNDLE_BUILD_RUN=YES\n'
printf ' BROWSER_MATRIX_RUN=NO\n'
printf ' LEDGER_PROMOTED=NO\n'
printf ' GITHUB_ACTIONS_DISPATCHED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
