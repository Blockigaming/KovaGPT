#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "FINALIZER_ERROR=not_in_git_repository" >&2
  exit 1
fi
cd "$REPO_ROOT"

EXPECTED_BRANCH="fix/non-actions-release-preparation"
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "FINALIZER_ERROR=wrong_branch expected=$EXPECTED_BRANCH actual=$CURRENT_BRANCH" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "24" ]]; then
  echo "FINALIZER_ERROR=node_24_required actual=$(node -v)" >&2
  exit 1
fi

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="artifacts/local-finalizer/$RUN_ID"
mkdir -p "$EVIDENCE_DIR"
AUTOSAVE_NAME="kova-finalizer-autosave-$RUN_ID"
AUTOSAVED="false"

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short >"$EVIDENCE_DIR/pre-autosave-status.txt"
  git diff --binary >"$EVIDENCE_DIR/pre-autosave.patch" || true
  git stash push --include-untracked -m "$AUTOSAVE_NAME" >/dev/null
  AUTOSAVED="true"
  echo "LOCAL_AUTOSAVE_CREATED=$AUTOSAVE_NAME"
fi

run_logged() {
  local name="$1"
  shift
  local log="$EVIDENCE_DIR/$name.log"
  echo "=== $name ==="
  if "$@" >"$log" 2>&1; then
    echo "PASS $name"
  else
    local status=$?
    echo "FAIL $name status=$status" >&2
    tail -200 "$log" >&2 || true
    exit "$status"
  fi
}

run_shell_logged() {
  local name="$1"
  shift
  local command="$*"
  local log="$EVIDENCE_DIR/$name.log"
  echo "=== $name ==="
  if bash -lc "$command" >"$log" 2>&1; then
    echo "PASS $name"
  else
    local status=$?
    echo "FAIL $name status=$status" >&2
    tail -200 "$log" >&2 || true
    exit "$status"
  fi
}

run_logged fetch git fetch origin "$EXPECTED_BRANCH" infra/verified-browser-image-provenance main
run_logged fast-forward git pull --ff-only origin "$EXPECTED_BRANCH"

BASE_SHA="$(git rev-parse HEAD)"
echo "FINALIZER_BASE_SHA=$BASE_SHA"

run_logged lockfile npm install --package-lock-only --no-audit --no-fund
run_logged dependencies npm install --no-audit --no-fund
run_logged parity-source node scripts/release/apply-chatgpt-parity-source.mjs
run_logged security-source node scripts/release/apply-security-source.mjs
run_logged migration-manifest npm run release:manifest
run_logged initial-build npm run build
run_logged formatting npx prettier --write .
run_logged route-regeneration npm run build
run_logged generated-format npx prettier --write src/routeTree.gen.ts release-migrations.json package-lock.json

run_logged format-check npm run format:check
run_logged lint npm run lint
run_logged typecheck npm run typecheck
run_logged unit npm run test:unit
run_logged api npm run test:api
run_logged integration npm run test:integration
run_logged release-tests npm run test:release
run_logged accessibility npm run test:a11y
run_logged visual-source npm run test:visual
run_logged browser-runtime npm run test:browser
run_logged npm-audit npm audit --audit-level=high

run_logged zero-lovable npm run release:zero-lovable
run_logged zero-lovable-strict npm run release:zero-lovable:strict
run_logged auth-provider npm run release:auth-provider
run_logged visible-controls node scripts/release/visible-control-contract.mjs
run_logged public-errors node scripts/release/public-error-contract.mjs
run_logged release-security npm run release:security
run_logged ai-runtime-security npm run security:ai-runtime
run_logged migrations npm run release:migrations
run_logged migration-preflight npm run release:migration-preflight
run_logged rls-dry npm run release:rls:two-user:dry
run_logged stripe-contract npm run release:stripe:contract
run_logged ai-provider npm run release:ai-provider-contract
run_logged azure-readiness npm run azure:validate
run_logged azure-staging npm run azure:staging:validate
run_logged isolated-db-dry npm run release:db:dry
run_logged full-release npm run release:validate
run_logged final-build npm run build

run_logged playwright-install npx playwright install chromium firefox webkit
run_logged release-browser-matrix npx playwright test --config=playwright.release.config.ts
if [[ "${KOVA_RELEASE_AUTH_STATE:-}" != "" ]]; then
  run_logged release-browser-authenticated env KOVA_RELEASE_AUTHENTICATED=1 npx playwright test --config=playwright.release.config.ts
else
  echo "SIGNED_IN_BROWSER_MATRIX=PENDING missing=KOVA_RELEASE_AUTH_STATE"
fi

run_logged source-transform-check node scripts/release/apply-chatgpt-parity-source.mjs --check
run_logged security-transform-check node scripts/release/apply-security-source.mjs --check
run_logged diff-check git diff --check

git status --short >"$EVIDENCE_DIR/final-status.txt"
git diff --stat >"$EVIDENCE_DIR/final-diff-stat.txt"
git diff --name-status >"$EVIDENCE_DIR/final-diff-files.txt"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "FINALIZER_NO_CHANGES=true"
else
  git add -A
  git commit -m "Finalize independent local release candidate [skip actions]"
fi

FINAL_SHA="$(git rev-parse HEAD)"
run_logged push git push origin HEAD:"$EXPECTED_BRANCH"

cat >"$EVIDENCE_DIR/summary.txt" <<EOF
base_sha=$BASE_SHA
final_sha=$FINAL_SHA
branch=$EXPECTED_BRANCH
autosaved=$AUTOSAVED
autosave_name=$AUTOSAVE_NAME
signed_out_browser_matrix=passed
signed_in_browser_matrix=$([[ "${KOVA_RELEASE_AUTH_STATE:-}" != "" ]] && echo passed || echo pending)
github_actions_expected=skipped_by_commit_marker
EOF

echo "KOVA_LOCAL_FINALIZER=PASS"
echo "KOVA_FINAL_SHA=$FINAL_SHA"
echo "KOVA_EVIDENCE_DIR=$EVIDENCE_DIR"
if [[ "$AUTOSAVED" == "true" ]]; then
  echo "KOVA_AUTOSAVE_STASH=$AUTOSAVE_NAME"
fi
