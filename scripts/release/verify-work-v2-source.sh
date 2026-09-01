#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
EXPECTED_BRANCH="finalization/checkpoint-2026-08-28"
EXPECTED_MIGRATIONS=89

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
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-work-v2.XXXXXX")"
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 36 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 360 "$LOG_DIR/$name.log"
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
  scripts/release/finalize-work-v2-source.sh
  scripts/release/verify-work-v2-source.sh
)
FORMAT_FILES=(
  package.json
  scripts/release/apply-work-v2-product.mjs
  scripts/release/apply-work-v2-source.mjs
  src/components/WorkRunComposer.tsx
  src/lib/work-execution-v2.server.ts
  src/lib/work.functions.ts
  src/routes/work.tsx
  src/workers/work-v2-runner.ts
  src/workers/work-v2.ts
  tests/unit/scheduled-worker-build-v2.test.mjs
  tests/unit/work-execution-v2-schema.test.mjs
  tests/unit/work-execution-v2-engine.test.mjs
  tests/unit/work-product-v2.test.mjs
  tests/unit/work-worker-v2.test.mjs
  tests/unit/work-worker-build-v2.test.mjs
  vite.work-worker.config.ts
)

for file in "${SHELL_FILES[@]}" "${FORMAT_FILES[@]}"; do
  [ -f "$file" ] || { echo "STOP=MISSING_WORK_V2_FILE:$file"; exit 1; }
done
[ -f supabase/migrations/20260901010000_work_execution_v2.sql ] || {
  echo "STOP=MISSING_WORK_V2_MIGRATION"
  exit 1
}

MIGRATION_COUNT="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATIONS" ]; then
  echo "STOP=UNEXPECTED_MIGRATION_COUNT:$MIGRATION_COUNT"
  exit 1
fi

gate shell-syntax bash -c '
  for file in "$@"; do
    bash -n "$file"
  done
' bash "${SHELL_FILES[@]}"

gate transform-idempotence bash -c '
  node scripts/release/apply-work-v2-source.mjs &&
  node scripts/release/apply-work-v2-product.mjs &&
  node_modules/.bin/prettier --write \
    package.json \
    src/lib/work-execution-v2.server.ts \
    src/lib/work.functions.ts \
    src/routes/work.tsx \
    tests/unit/scheduled-worker-build-v2.test.mjs
'
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=WORK_TRANSFORM_NOT_IDEMPOTENT"
  git status --short --branch
  git diff --stat
  exit 1
fi

gate targeted-format node_modules/.bin/prettier --check "${FORMAT_FILES[@]}"
gate targeted-lint node_modules/.bin/eslint \
  scripts/release/apply-work-v2-product.mjs \
  scripts/release/apply-work-v2-source.mjs \
  src/components/WorkRunComposer.tsx \
  src/lib/work-execution-v2.server.ts \
  src/lib/work.functions.ts \
  src/routes/work.tsx \
  src/workers/work-v2-runner.ts \
  src/workers/work-v2.ts \
  tests/unit/scheduled-worker-build-v2.test.mjs \
  tests/unit/work-execution-v2-schema.test.mjs \
  tests/unit/work-execution-v2-engine.test.mjs \
  tests/unit/work-product-v2.test.mjs \
  tests/unit/work-worker-v2.test.mjs \
  tests/unit/work-worker-build-v2.test.mjs \
  vite.work-worker.config.ts

gate migration-contract node scripts/release/migrations.mjs
gate migration-preflight node scripts/release/migration-preflight.mjs --source-only

WORK_TESTS=(
  tests/unit/work-execution-v2-schema.test.mjs
  tests/unit/work-execution-v2-engine.test.mjs
  tests/unit/work-product-v2.test.mjs
  tests/unit/work-worker-v2.test.mjs
  tests/unit/work-worker-build-v2.test.mjs
  tests/unit/scheduled-worker-build-v2.test.mjs
  tests/unit/helios-worker.test.mjs
)
for candidate in \
  tests/integration/work-experience-source.test.mjs \
  tests/integration/agent-ingress-authorization-source.test.mjs \
  tests/integration/constellation-source.test.mjs; do
  if [ -f "$candidate" ]; then
    WORK_TESTS+=("$candidate")
  fi
done

gate work-source-tests node --test "${WORK_TESTS[@]}"
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

# A disabled Work worker must terminate before requesting Supabase, provider, or
# managed-identity credentials. This is a source gate, not a live provider call.
set +e
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production \
  node dist/worker/work-v2.mjs >"$LOG_DIR/work-fail-closed.log" 2>&1
FAIL_CLOSED_CODE=$?
set -e
if [ "$FAIL_CLOSED_CODE" -eq 0 ]; then
  echo "STOP=WORK_BUNDLE_DID_NOT_FAIL_CLOSED"
  cat "$LOG_DIR/work-fail-closed.log"
  exit 1
fi
if grep -Eqi 'Missing Supabase|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|AZURE_OPENAI_API_KEY|IDENTITY_HEADER' \
  "$LOG_DIR/work-fail-closed.log"; then
  echo "STOP=WORK_BUNDLE_TOUCHED_SECRETS_WHILE_DISABLED"
  cat "$LOG_DIR/work-fail-closed.log"
  exit 1
fi
printf 'work-worker-fail-closed=PASS\n'
tail -n 8 "$LOG_DIR/work-fail-closed.log"

MIGRATION="supabase/migrations/20260901010000_work_execution_v2.sql"
grep -qF "create or replace function public.owner_create_work_job_v2" "$MIGRATION" || {
  echo "STOP=WORK_OWNER_CREATE_RPC_MISSING"
  exit 1
}
grep -qF "create or replace function public.claim_work_job_v2" "$MIGRATION" || {
  echo "STOP=WORK_CLAIM_RPC_MISSING"
  exit 1
}
grep -qF "create or replace function public.checkpoint_work_job_v2" "$MIGRATION" || {
  echo "STOP=WORK_CHECKPOINT_RPC_MISSING"
  exit 1
}
grep -qF "create or replace function public.request_work_approval_v2" "$MIGRATION" || {
  echo "STOP=WORK_APPROVAL_RPC_MISSING"
  exit 1
}
grep -qF "create or replace function public.settle_work_success_v2" "$MIGRATION" || {
  echo "STOP=WORK_SUCCESS_SETTLEMENT_MISSING"
  exit 1
}
grep -qF "create or replace function public.recover_expired_work_attempts_v2" "$MIGRATION" || {
  echo "STOP=WORK_RECOVERY_RPC_MISSING"
  exit 1
}
grep -qF "set enabled = false" "$MIGRATION" || {
  echo "STOP=WORK_RUNTIME_DEFAULT_NOT_DISABLED"
  exit 1
}
grep -qF 'KOVA_WORK_MODEL_PROVIDER !== "azure-managed-identity"' \
  src/lib/work-execution-v2.server.ts || {
  echo "STOP=WORK_MANAGED_IDENTITY_BOUNDARY_MISSING"
  exit 1
}
grep -qF 'work_direct_api_key_forbidden' src/lib/work-execution-v2.server.ts || {
  echo "STOP=WORK_DIRECT_KEY_REJECTION_MISSING"
  exit 1
}
grep -qF 'tools that are not yet available in the isolated Work worker' \
  src/lib/work-execution-v2.server.ts || {
  echo "STOP=WORK_TOOL_RUNTIME_NOT_FAIL_CLOSED"
  exit 1
}
grep -qF 'export const workExecutionAvailable = false;' src/lib/work.functions.ts || {
  echo "STOP=WORK_PRODUCT_SOURCE_DEFAULT_NOT_DISABLED"
  exit 1
}
grep -qF 'process.env.KOVA_WORK_EXECUTION_ENABLED' src/lib/work.functions.ts || {
  echo "STOP=WORK_RUNTIME_FLAG_MISSING"
  exit 1
}
grep -qF 'owner_create_work_job_v2' src/lib/work.functions.ts || {
  echo "STOP=WORK_PRODUCT_CREATION_RPC_MISSING"
  exit 1
}
grep -qF '<WorkRunComposer' src/routes/work.tsx || {
  echo "STOP=WORK_RUNTIME_GATED_COMPOSER_MISSING"
  exit 1
}
grep -qF 'Agent execution is unavailable.' src/routes/work.tsx || {
  echo "STOP=WORK_UI_FAIL_CLOSED_COPY_MISSING"
  exit 1
}
grep -qF '{ error: "browser_agent_unavailable" }' src/routes/api/agents/runs.ts || {
  echo "STOP=INCOMPATIBLE_AGENT_INGRESS_PREMATURELY_ENABLED"
  exit 1
}

git diff --check
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=VALIDATION_CHANGED_TRACKED_FILES"
  git status --short --branch
  exit 1
fi

printf '\n============================================================\n'
printf ' KOVAGPT_WORK_EXECUTION_V2_SOURCE=PASS\n'
printf ' SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf ' MIGRATION_COUNT=%s\n' "$MIGRATION_COUNT"
printf ' CANONICAL_QUEUE=agent_jobs\n'
printf ' OWNER_CREATION_CONTROL=SOURCE_VERIFIED\n'
printf ' FENCED_LEASE_HEARTBEAT=SOURCE_VERIFIED\n'
printf ' CHECKPOINT_EVENT_PROTOCOL=SOURCE_VERIFIED\n'
printf ' APPROVAL_PROTOCOL=SOURCE_VERIFIED\n'
printf ' BOUNDED_RETRY_RECOVERY=SOURCE_VERIFIED\n'
printf ' MODEL_ONLY_WORKER=SOURCE_VERIFIED\n'
printf ' MANAGED_IDENTITY_ONLY=SOURCE_VERIFIED\n'
printf ' TOOL_EXECUTION=FAIL_CLOSED\n'
printf ' WORK_UI=RUNTIME_GATED_MODEL_ONLY\n'
printf ' WORK_RUNTIME_DEFAULT=DISABLED\n'
printf ' PRODUCTION_MIGRATIONS_APPLIED=0\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' APPLICATION_BUILD_RUN=NO\n'
printf ' WORKER_BUNDLE_BUILD_RUN=YES\n'
printf ' FULL_BROWSER_MATRIX_RUN=NO\n'
printf ' LEDGER_PROMOTED=NO\n'
printf ' GITHUB_ACTIONS_DISPATCHED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
