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
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-scheduled-azure-v2.XXXXXX")"
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 24 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 260 "$LOG_DIR/$name.log"
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

for tool in node eslint prettier; do
  if [ ! -x "node_modules/.bin/$tool" ] && [ "$tool" != "node" ]; then
    echo "STOP=MISSING_LOCAL_TOOL_$tool"
    exit 1
  fi
done
command -v node >/dev/null || { echo "STOP=MISSING_NODE"; exit 1; }

FILES=(
  scripts/release/apply-scheduled-azure-v2.mjs
  scripts/azure/template-contract.mjs
  scripts/azure/validate-production-template.mjs
  scripts/azure/validate-staging-template.mjs
  tests/unit/azure-production-template.test.mjs
  tests/unit/azure-staging-template.test.mjs
  tests/unit/scheduled-azure-v2-source.test.mjs
)

gate apply-syntax node --check scripts/release/apply-scheduled-azure-v2.mjs
gate source-test-syntax node --check tests/unit/scheduled-azure-v2-source.test.mjs
gate targeted-format node_modules/.bin/prettier --check "${FILES[@]}"
gate targeted-lint node_modules/.bin/eslint "${FILES[@]}"
gate production-template node scripts/azure/validate-production-template.mjs
gate staging-template node scripts/azure/validate-staging-template.mjs
gate azure-source-tests node --test \
  tests/unit/azure-production-template.test.mjs \
  tests/unit/azure-staging-template.test.mjs \
  tests/unit/scheduled-azure-v2-source.test.mjs

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
    echo "STOP=SCHEDULED_WORKER_MODULE_NOT_WIRED:$template"
    exit 1
  }
  if grep -Eq "var schedulerScript = '''|KOVA_SCHEDULED_EXECUTION_ENDPOINT" "$template"; then
    echo "STOP=OBSOLETE_HTTP_SCHEDULER_PRESENT:$template"
    exit 1
  fi
done

grep -qF "'dist/worker/scheduled-v2.mjs'" infra/azure/modules/scheduled-worker-job.bicep || {
  echo "STOP=DEDICATED_WORKER_ENTRY_MISSING"
  exit 1
}
grep -qF "Microsoft.Insights/scheduledQueryRules@2023-12-01" infra/azure/modules/scheduled-worker-job.bicep || {
  echo "STOP=SCHEDULER_ALERTS_MISSING"
  exit 1
}
grep -qF 'export const scheduledExecutionAvailable = false;' src/lib/scheduled-tasks.functions.ts || {
  echo "STOP=PRODUCT_FAIL_CLOSED_LOST"
  exit 1
}

git diff --check
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=VALIDATION_CHANGED_TRACKED_FILES"
  git status --short --branch
  exit 1
fi

printf '\n============================================================\n'
printf ' KOVAGPT_SCHEDULED_AZURE_V2_SOURCE=PASS\n'
printf ' SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf ' BICEP_COMPILE=%s\n' "$BICEP_COMPILE"
printf ' DEDICATED_SCHEDULED_WORKER=SOURCE_VERIFIED\n'
printf ' SCHEDULER_FAILURE_ALERT=SOURCE_VERIFIED\n'
printf ' SCHEDULER_MISSING_SUCCESS_ALERT=SOURCE_VERIFIED\n'
printf ' SCHEDULER_ENABLED=NO\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' GITHUB_ACTIONS_DISPATCHED=0\n'
printf ' BROWSER_MATRIX_RUN=NO\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
