#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
BRANCH="finalization/checkpoint-2026-08-28"
if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  echo "STOP=WRONG_BRANCH"
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=TRACKED_OR_STAGED_CHANGES"
  git status --short
  exit 1
fi

SOURCE_SHA="$(git rev-parse HEAD)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-preview-repair.XXXXXX")"
BASE_URL="http://127.0.0.1:8095"
PREVIEW_PID=""
cleanup() {
  if [ -n "$PREVIEW_PID" ]; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
    wait "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 8 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 180 "$LOG_DIR/$name.log"
    if [ "$name" = "webkit-diagnostic" ] && [ -s "$LOG_DIR/webkit-diagnostic.json" ]; then
      cat "$LOG_DIR/webkit-diagnostic.json"
    fi
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"
for tool in eslint tsc vite playwright; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    printf 'STOP=MISSING_LOCAL_TOOL_%s\n' "$tool"
    exit 1
  fi
done

gate syntax node --check scripts/release/diagnose-browser-runtime.mjs
gate targeted-lint node_modules/.bin/eslint \
  src/start.ts src/server.ts src/lib/local-preview-security.server.ts \
  scripts/release/browser-runtime-events.mjs scripts/release/diagnose-browser-runtime.mjs \
  playwright.release.config.ts \
  tests/unit/local-preview-security.test.mjs tests/unit/browser-runtime-events.test.mjs
gate regression node --test \
  tests/unit/local-preview-security.test.mjs tests/unit/browser-runtime-events.test.mjs
gate typecheck node_modules/.bin/tsc --noEmit
# Request hardening changed, so recheck the fast request/source integration suite.
gate integration npm run test:integration
gate build env KOVA_BUILD_SHA="$SOURCE_SHA" KOVA_NITRO_PRESET=node-server npm run build
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=BUILD_MODIFIED_TRACKED_FILES"
  git status --short
  exit 1
fi

gate preview-port node --input-type=module <<'NODE'
import { createServer } from "node:net";
const server = createServer();
server.once("error", (error) => {
  console.error(`STOP=LOCAL_PORT_8095_${error.code}`);
  process.exitCode = 1;
});
server.listen({ host: "127.0.0.1", port: 8095, exclusive: true }, () => server.close());
NODE

KOVA_LOCAL_HTTP_PREVIEW=1 AI_GENERATION_ENABLED=false KOVA_GENERATION_DISABLED=true \
  node_modules/.bin/vite preview --host 127.0.0.1 --port 8095 --strictPort \
  >"$LOG_DIR/preview.log" 2>&1 &
PREVIEW_PID=$!
ready=0
for ((attempt=0; attempt<80; attempt++)); do
  if ! kill -0 "$PREVIEW_PID" >/dev/null 2>&1; then
    echo "STOP=PREVIEW_EXITED_OR_PORT_BUSY"
    tail -n 120 "$LOG_DIR/preview.log"
    exit 1
  fi
  if curl --silent --fail --max-time 2 "$BASE_URL/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" -ne 1 ]; then
  echo "STOP=PREVIEW_NOT_READY"
  tail -n 120 "$LOG_DIR/preview.log"
  exit 1
fi

# Verify the real HTTP policy before spending time launching a browser.
gate preview-headers node --input-type=module - "$BASE_URL" <<'NODE'
import assert from "node:assert/strict";
const response = await fetch(process.argv[2], { signal: AbortSignal.timeout(5000) });
const policy = response.headers.get("content-security-policy") ?? "";
console.log(`HTTP_STATUS=${response.status}`);
console.log(`CONTENT_SECURITY_POLICY=${policy}`);
assert.equal(response.ok, true);
assert.match(policy, /default-src 'self'/u);
assert.doesNotMatch(policy, /upgrade-insecure-requests/iu);
assert.equal(response.headers.has("strict-transport-security"), false);
assert.equal(response.headers.get("x-content-type-options"), "nosniff");
NODE

gate webkit-diagnostic node scripts/release/diagnose-browser-runtime.mjs \
  --engine=webkit --url="$BASE_URL/" --width=390 --height=844 \
  --timeout-ms=30000 --settle-ms=0 --output="$LOG_DIR/webkit-diagnostic.json"
# Restrict this pass to two theme/composer tests, not the final browser matrix.
gate webkit-smoke env \
  PLAYWRIGHT_BASE_URL="$BASE_URL" KOVA_RELEASE_AUTHENTICATED=0 \
  PLAYWRIGHT_HTML_OPEN=never \
  node_modules/.bin/playwright test tests/release-browser/final-matrix.spec.ts \
  --config=playwright.release.config.ts --project=signed-out-webkit-390 \
  --grep="ChatGPT-first shell" --workers=1 --retries=0 --max-failures=1 \
  --reporter=line --output="$LOG_DIR/webkit-results"

git diff --check
printf '\nKOVAGPT_PREVIEW_TRANSPORT_REPAIR=PASS\n'
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"
printf 'FULL_MATRIX_RUN=NO\nLEDGER_PROMOTED=NO\nPUSHED=NO\n'
printf 'GITHUB_ACTIONS_DISPATCHED=0\nAZURE_DEPLOYMENTS=0\nLOVABLE_CREDITS_USED=0\n'
