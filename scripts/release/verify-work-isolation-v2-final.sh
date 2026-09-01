#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BRANCH="work-v2/isolation-runtime"
EXPECTED_MIGRATIONS=90
LATEST_MIGRATION="20260901100000_work_browser_research_v2.sql"

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

for tool in prettier tsc vite; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    echo "STOP=MISSING_LOCAL_TOOL_$tool"
    exit 1
  fi
done
for tool in node npm git; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "STOP=MISSING_TOOL_$tool"
    exit 1
  }
done

SOURCE_SHA="$(git rev-parse HEAD)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-work-isolation-v2.XXXXXX")"
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 60 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 360 "$LOG_DIR/$name.log"
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

SHELL_FILES=(
  scripts/release/finalize-work-isolation-v2-final.sh
  scripts/release/verify-work-isolation-v2-final.sh
)
NODE_FILES=(
  browser-worker/src/azure-openai.mjs
  browser-worker/src/index.mjs
  browser-worker/src/network-safety.mjs
  browser-worker/src/page-capture.mjs
  browser-worker/src/runner.mjs
  tests/unit/work-browser-azure-v2.test.mjs
  tests/unit/work-browser-network-v2.test.mjs
  tests/unit/work-browser-runner-v2.test.mjs
  tests/unit/work-browser-source-v2.test.mjs
)
FORMAT_FILES=(
  release-migrations.json
  "${NODE_FILES[@]}"
)
REQUIRED_FILES=(
  browser-worker/Dockerfile
  infra/azure/modules/work-worker-jobs.bicep
  "supabase/migrations/$LATEST_MIGRATION"
  "${SHELL_FILES[@]}"
  "${NODE_FILES[@]}"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "STOP=MISSING_WORK_ISOLATION_FILE:$file"
    exit 1
  fi
done

MIGRATION_COUNT="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATIONS" ]; then
  echo "STOP=UNEXPECTED_MIGRATION_COUNT:$MIGRATION_COUNT"
  exit 1
fi

# The package is intentionally source-only and disabled. These checks do not
# apply migrations, call a provider, launch a real browser action, or deploy.
gate shell-syntax bash -c '
  for file in "$@"; do
    bash -n "$file"
  done
' bash "${SHELL_FILES[@]}"

gate node-syntax bash -c '
  for file in "$@"; do
    node --check "$file"
  done
' bash "${NODE_FILES[@]}"

gate targeted-format node_modules/.bin/prettier --check "${FORMAT_FILES[@]}"
gate migration-contract node scripts/release/migrations.mjs
gate migration-preflight node scripts/release/migration-preflight.mjs --source-only

gate manifest-contract env \
  EXPECTED_MIGRATIONS="$EXPECTED_MIGRATIONS" \
  LATEST_MIGRATION="$LATEST_MIGRATION" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("release-migrations.json", "utf8"));
assert.equal(manifest.count, Number(process.env.EXPECTED_MIGRATIONS));
assert.equal(manifest.migrations.length, Number(process.env.EXPECTED_MIGRATIONS));
assert.equal(manifest.latest, process.env.LATEST_MIGRATION);
assert.equal(manifest.migrations.at(-1)?.filename, process.env.LATEST_MIGRATION);
console.log("WORK_ISOLATION_MANIFEST=PASS");
NODE

BROWSER_TESTS=(
  tests/unit/work-browser-azure-v2.test.mjs
  tests/unit/work-browser-network-v2.test.mjs
  tests/unit/work-browser-runner-v2.test.mjs
  tests/unit/work-browser-source-v2.test.mjs
)
gate browser-isolation-tests node --test "${BROWSER_TESTS[@]}"

WORK_REGRESSIONS=(
  tests/unit/work-execution-v2-schema.test.mjs
  tests/unit/work-execution-v2-engine.test.mjs
  tests/unit/work-product-v2.test.mjs
  tests/unit/work-worker-v2.test.mjs
  tests/unit/work-worker-build-v2.test.mjs
  tests/unit/helios-worker.test.mjs
)
for file in "${WORK_REGRESSIONS[@]}"; do
  if [ ! -f "$file" ]; then
    echo "STOP=MISSING_WORK_REGRESSION:$file"
    exit 1
  fi
done
gate work-regressions node --test "${WORK_REGRESSIONS[@]}"
gate typecheck node_modules/.bin/tsc --noEmit
gate worker-bundles npm run build:workers

for bundle in dist/worker/scheduled-v2.mjs dist/worker/work-v2.mjs; do
  if [ ! -s "$bundle" ]; then
    echo "STOP=WORKER_BUNDLE_MISSING:$bundle"
    exit 1
  fi
done
if find dist/worker -type f -name '*.map' -print -quit | grep -q .; then
  echo "STOP=WORKER_SOURCE_MAP_PRESENT"
  exit 1
fi
gate scheduled-bundle-syntax node --check dist/worker/scheduled-v2.mjs
gate work-bundle-syntax node --check dist/worker/work-v2.mjs

# Disabled startup must stop before requesting Supabase or provider secrets.
set +e
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production \
  node browser-worker/src/index.mjs >"$LOG_DIR/browser-worker-fail-closed.log" 2>&1
FAIL_CLOSED_CODE=$?
set -e
if [ "$FAIL_CLOSED_CODE" -eq 0 ]; then
  echo "STOP=BROWSER_WORKER_DID_NOT_FAIL_CLOSED"
  cat "$LOG_DIR/browser-worker-fail-closed.log"
  exit 1
fi
if grep -Eqi 'SUPABASE_SERVICE_ROLE_KEY|AZURE_OPENAI_API_KEY|OPENAI_API_KEY|IDENTITY_HEADER|browser_supabase_url_required|browser_supabase_service_key_required' \
  "$LOG_DIR/browser-worker-fail-closed.log"; then
  echo "STOP=BROWSER_WORKER_TOUCHED_SECRETS_WHILE_DISABLED"
  cat "$LOG_DIR/browser-worker-fail-closed.log"
  exit 1
fi
echo "browser-worker-fail-closed=PASS"
tail -n 12 "$LOG_DIR/browser-worker-fail-closed.log"

if command -v az >/dev/null 2>&1; then
  gate work-job-bicep az bicep build \
    --file infra/azure/modules/work-worker-jobs.bicep \
    --stdout
  BICEP_COMPILE="PASS"
else
  BICEP_COMPILE="SKIPPED_AZURE_CLI_NOT_INSTALLED"
  echo "work-job-bicep=$BICEP_COMPILE"
fi

git diff --check
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=VALIDATION_CHANGED_TRACKED_FILES"
  git status --short --branch
  git diff --stat
  exit 1
fi

printf '\n============================================================\n'
printf ' KOVAGPT_WORK_ISOLATION_V2_SOURCE=PASS\n'
printf ' SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf ' MIGRATION_COUNT=%s\n' "$MIGRATION_COUNT"
printf ' LATEST_MIGRATION=%s\n' "$LATEST_MIGRATION"
printf ' PINNED_HTTPS_DNS=SOURCE_VERIFIED\n'
printf ' SSRF_DNS_REBINDING_GUARD=SOURCE_VERIFIED\n'
printf ' READ_ONLY_BROWSER_BOUNDARY=SOURCE_VERIFIED\n'
printf ' TRANSACTIONAL_EVIDENCE=SOURCE_VERIFIED\n'
printf ' MANAGED_IDENTITY_SYNTHESIS=SOURCE_VERIFIED\n'
printf ' EXACT_SHA_WORKER_READINESS=SOURCE_VERIFIED\n'
printf ' AZURE_WORK_JOB_MODULE=SOURCE_VERIFIED_NOT_DEPLOYED\n'
printf ' BICEP_COMPILE=%s\n' "$BICEP_COMPILE"
printf ' BROWSER_WORK_RUNTIME_DEFAULT=DISABLED\n'
printf ' BROWSER_WORK_PRODUCT_UI=NOT_ENABLED\n'
printf ' PRODUCTION_MIGRATIONS_APPLIED=0\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' REAL_BROWSER_ACTIONS=0\n'
printf ' FULL_BROWSER_MATRIX_RUN=NO\n'
printf ' LEDGER_PROMOTED=NO\n'
printf ' GITHUB_ACTIONS_DISPATCHED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
