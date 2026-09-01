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

UNTRACKED_SOURCE="$(
  git ls-files --others --exclude-standard |
    grep -v '^release-artifacts/' |
    sort || true
)"
if [ -n "$UNTRACKED_SOURCE" ]; then
  echo "STOP=UNEXPECTED_UNTRACKED_SOURCE"
  printf '%s\n' "$UNTRACKED_SOURCE"
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

git fetch origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
BASE_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
if [ "$BASE_SHA" != "$REMOTE_SHA" ]; then
  echo "STOP=LOCAL_REMOTE_HEAD_MISMATCH"
  echo "LOCAL_SHA=$BASE_SHA"
  echo "REMOTE_SHA=$REMOTE_SHA"
  exit 1
fi
printf 'BASE_SHA=%s\n' "$BASE_SHA"

FORMAT_FILES=(
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
ALLOWED_FILES=(
  release-migrations.json
  "${FORMAT_FILES[@]}"
)

for file in \
  "${FORMAT_FILES[@]}" \
  scripts/release/finalize-work-isolation-v2-final.sh \
  scripts/release/verify-work-isolation-v2-final.sh \
  "supabase/migrations/$LATEST_MIGRATION"; do
  if [ ! -f "$file" ]; then
    echo "STOP=MISSING_WORK_ISOLATION_FILE:$file"
    exit 1
  fi
done

printf '\n=== 1. NORMALIZE ONLY THE WORK ISOLATION SOURCE ===\n'
node_modules/.bin/prettier --write "${FORMAT_FILES[@]}"

printf '\n=== 2. REGENERATE THE 90-MIGRATION MANIFEST ONCE ===\n'
npm run release:manifest
node_modules/.bin/prettier --write release-migrations.json

MIGRATION_COUNT="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
if [ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATIONS" ]; then
  echo "STOP=UNEXPECTED_MIGRATION_COUNT:$MIGRATION_COUNT"
  exit 1
fi

env EXPECTED_MIGRATIONS="$EXPECTED_MIGRATIONS" LATEST_MIGRATION="$LATEST_MIGRATION" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("release-migrations.json", "utf8"));
assert.equal(manifest.count, Number(process.env.EXPECTED_MIGRATIONS));
assert.equal(manifest.migrations.length, Number(process.env.EXPECTED_MIGRATIONS));
assert.equal(manifest.latest, process.env.LATEST_MIGRATION);
assert.equal(manifest.migrations.at(-1)?.filename, process.env.LATEST_MIGRATION);
console.log("MIGRATION_MANIFEST_90=PASS");
NODE

git diff --check

printf '\n=== 3. PROVE THE EXACT MUTATION SCOPE ===\n'
CHANGED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-work-isolation-changed.XXXXXX")"
ALLOWED_FILE="$(mktemp "${TMPDIR:-/tmp}/kova-work-isolation-allowed.XXXXXX")"
cleanup() { rm -f "$CHANGED_FILE" "$ALLOWED_FILE"; }
trap cleanup EXIT

printf '%s\n' "${ALLOWED_FILES[@]}" | sort -u >"$ALLOWED_FILE"
git diff --name-only | sort -u >"$CHANGED_FILE"

UNEXPECTED="$(comm -23 "$CHANGED_FILE" "$ALLOWED_FILE")"
if [ -n "$UNEXPECTED" ]; then
  echo "STOP=UNEXPECTED_TRACKED_CHANGES"
  printf '%s\n' "$UNEXPECTED"
  git status --short --branch
  exit 1
fi

if [ -s "$CHANGED_FILE" ]; then
  grep -qxF release-migrations.json "$CHANGED_FILE" || {
    echo "STOP=MIGRATION_MANIFEST_NOT_UPDATED"
    cat "$CHANGED_FILE"
    exit 1
  }
  echo "CHANGE_SCOPE=PASS"
  cat "$CHANGED_FILE"

  printf '\n=== 4. COMMIT THE FIXED-POINT SOURCE CLOSURE ===\n'
  while IFS= read -r file; do
    git add -- "$file"
  done <"$CHANGED_FILE"
  git diff --cached --check
  git commit -m "chore: finalize Work browser isolation source [skip actions] [skip ci]"
else
  echo "CHANGE_SCOPE=FIXED_POINT_NO_MUTATION_REQUIRED"
  printf '\n=== 4. SOURCE IS ALREADY AT THE FIXED POINT ===\n'
fi

FINAL_SHA="$(git rev-parse HEAD)"
printf 'FINAL_SHA=%s\n' "$FINAL_SHA"

printf '\n=== 5. RUN THE COMPLETE ZERO-COST SOURCE GATE ===\n'
bash scripts/release/verify-work-isolation-v2-final.sh

printf '\n=== 6. PUSH ONLY AFTER COMPLETE SUCCESS ===\n'
if [ "$FINAL_SHA" != "$BASE_SHA" ]; then
  git fetch origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  CURRENT_REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
  if [ "$CURRENT_REMOTE_SHA" != "$BASE_SHA" ]; then
    echo "STOP=REMOTE_MOVED_DURING_VERIFICATION"
    echo "BASE_SHA=$BASE_SHA"
    echo "REMOTE_SHA=$CURRENT_REMOTE_SHA"
    exit 1
  fi
  git push origin "$BRANCH"
else
  echo "PUSH=NOT_REQUIRED_REMOTE_ALREADY_AT_VERIFIED_SHA"
fi

printf '\n=== 7. FINAL STATE ===\n'
git status --short --branch
git log -8 --oneline --decorate

printf '\n============================================================\n'
printf ' KOVAGPT_WORK_ISOLATION_V2_FINAL=PASS\n'
printf ' VERIFIED_SHA=%s\n' "$FINAL_SHA"
printf ' MIGRATION_COUNT=%s\n' "$MIGRATION_COUNT"
printf ' PINNED_HTTPS_DNS=SOURCE_VERIFIED\n'
printf ' SSRF_DNS_REBINDING_GUARD=SOURCE_VERIFIED\n'
printf ' READ_ONLY_BROWSER_BOUNDARY=SOURCE_VERIFIED\n'
printf ' TRANSACTIONAL_EVIDENCE=SOURCE_VERIFIED\n'
printf ' MANAGED_IDENTITY_SYNTHESIS=SOURCE_VERIFIED\n'
printf ' EXACT_SHA_WORKER_READINESS=SOURCE_VERIFIED\n'
printf ' AZURE_WORK_JOB_MODULE=SOURCE_VERIFIED_NOT_DEPLOYED\n'
printf ' BROWSER_WORK_RUNTIME_DEFAULT=DISABLED\n'
printf ' BROWSER_WORK_PRODUCT_UI=NOT_ENABLED\n'
printf ' PRODUCTION_MIGRATIONS_APPLIED=0\n'
printf ' PROVIDER_LIVE_CALLS=0\n'
printf ' REAL_BROWSER_ACTIONS=0\n'
printf ' FULL_BROWSER_MATRIX_RUN=NO\n'
printf ' LEDGER_PROMOTED=NO\n'
printf ' GITHUB_ACTIONS_REQUESTED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'
