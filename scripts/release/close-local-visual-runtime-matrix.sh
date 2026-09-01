#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BRANCH="finalization/checkpoint-2026-08-28"
PORT="${KOVA_MATRIX_PORT:-8097}"
BASE_URL="http://127.0.0.1:${PORT}"
PRIVATE_DIR="${KOVA_PRIVATE_DIR:-$HOME/.kova-private}"
AUTH_STATE="${KOVA_RELEASE_AUTH_STATE:-$PRIVATE_DIR/release-auth-state-${PORT}.json}"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-local-matrix.XXXXXX")"
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

fail() {
  echo "STOP=$1"
  echo "LOG_DIRECTORY=$LOG_DIR"
  exit 1
}

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
    tail -n 240 "$LOG_DIR/$name.log"
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

printf '\n============================================================\n'
printf ' KOVAGPT EXACT-SHA LOCAL VISUAL RUNTIME CLOSURE\n'
printf '============================================================\n'

printf '\n=== 1. REPOSITORY SAFETY ===\n'
[ "$(git branch --show-current)" = "$BRANCH" ] || fail WRONG_BRANCH
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short --branch
  fail TRACKED_OR_STAGED_CHANGES
fi
UNTRACKED_SOURCE="$(
  git ls-files --others --exclude-standard |
    grep -v '^release-artifacts/' |
    sort || true
)"
[ -z "$UNTRACKED_SOURCE" ] || {
  printf '%s\n' "$UNTRACKED_SOURCE"
  fail UNEXPECTED_UNTRACKED_SOURCE
}
for tool in prettier eslint tsc vite playwright; do
  [ -x "node_modules/.bin/$tool" ] || fail "MISSING_LOCAL_TOOL_${tool}"
done
for tool in node npm git curl; do
  command -v "$tool" >/dev/null 2>&1 || fail "MISSING_TOOL_${tool}"
done

git fetch origin "$BRANCH"
SOURCE_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
[ "$SOURCE_SHA" = "$REMOTE_SHA" ] || {
  echo "LOCAL_SHA=$SOURCE_SHA"
  echo "REMOTE_SHA=$REMOTE_SHA"
  fail LOCAL_REMOTE_HEAD_MISMATCH
}
SOURCE_TREE="$(git rev-parse 'HEAD^{tree}')"
SHORT_SHA="${SOURCE_SHA:0:12}"
EVIDENCE_DIR="release-artifacts/local-visual-runtime-matrix/$SOURCE_SHA"
mkdir -p "$EVIDENCE_DIR" "$PRIVATE_DIR"
chmod 700 "$PRIVATE_DIR"
printf 'SOURCE_SHA=%s\nSOURCE_TREE=%s\nBASE_URL=%s\n' "$SOURCE_SHA" "$SOURCE_TREE" "$BASE_URL"
echo "REPOSITORY_SAFETY=PASS"
echo "RELEASE_ARTIFACTS_PRESERVED=YES"

printf '\n=== 2. PLAYWRIGHT ENGINE AVAILABILITY ===\n'
if ! node --input-type=module <<'NODE' >"$LOG_DIR/browser-preflight.log" 2>&1
import { chromium, firefox, webkit } from "@playwright/test";
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch({ headless: true });
  await browser.close();
  console.log(`${name}=ready`);
}
NODE
then
  echo "PLAYWRIGHT_BROWSERS=MISSING_INSTALLING_ONCE"
  npx playwright install chromium firefox webkit
  gate browser-preflight-after-install node --input-type=module <<'NODE'
import { chromium, firefox, webkit } from "@playwright/test";
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch({ headless: true });
  await browser.close();
  console.log(`${name}=ready`);
}
NODE
else
  cat "$LOG_DIR/browser-preflight.log"
  echo "PLAYWRIGHT_BROWSERS=PASS"
fi

printf '\n=== 3. EXACT-SHA PRODUCTION BUILD ===\n'
gate exact-sha-build env \
  KOVA_BUILD_SHA="$SOURCE_SHA" \
  KOVA_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  KOVA_NITRO_PRESET=node-server \
  npm run build
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short --branch
  fail BUILD_CHANGED_TRACKED_SOURCE
fi

printf '\n=== 4. START ONE LOCAL PREVIEW ===\n'
node --input-type=module - "$PORT" <<'NODE'
import { createServer } from "node:net";
const port = Number(process.argv[2]);
const server = createServer();
server.once("error", (error) => {
  console.error(`PORT_UNAVAILABLE=${error.code ?? error.message}`);
  process.exitCode = 1;
});
server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close());
NODE

KOVA_LOCAL_HTTP_PREVIEW=1 \
AI_GENERATION_ENABLED=false \
KOVA_GENERATION_DISABLED=true \
npm run preview -- --host 127.0.0.1 --port "$PORT" --strictPort \
  >"$LOG_DIR/preview.log" 2>&1 &
PREVIEW_PID=$!

READY=0
for _ in $(seq 1 120); do
  if ! kill -0 "$PREVIEW_PID" >/dev/null 2>&1; then
    tail -n 160 "$LOG_DIR/preview.log"
    fail PREVIEW_EXITED
  fi
  if curl --silent --fail --max-time 2 "$BASE_URL/api/version" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done
[ "$READY" = 1 ] || {
  tail -n 160 "$LOG_DIR/preview.log"
  fail PREVIEW_NOT_READY
}

gate exact-build-identity env KOVA_MATRIX_BASE_URL="$BASE_URL" KOVA_MATRIX_SOURCE_SHA="$SOURCE_SHA" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const response = await fetch(`${process.env.KOVA_MATRIX_BASE_URL}/api/version`, {
  signal: AbortSignal.timeout(5000),
});
assert.equal(response.ok, true);
const identity = await response.json();
assert.equal(identity.sha, process.env.KOVA_MATRIX_SOURCE_SHA);
assert.equal(response.headers.get("x-kova-build"), process.env.KOVA_MATRIX_SOURCE_SHA);
assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
console.log(`EXACT_BUILD_SHA=${identity.sha}`);
NODE

printf '\n=== 5. EXACT-SHA WEBKIT RUNTIME DIAGNOSTIC ===\n'
gate webkit-diagnostic node scripts/release/diagnose-browser-runtime.mjs \
  --engine=webkit \
  --url="$BASE_URL/" \
  --width=390 \
  --height=844 \
  --timeout-ms=30000 \
  --settle-ms=0 \
  --output="$EVIDENCE_DIR/webkit-runtime-diagnostic.json"

printf '\n=== 6. SIGNED-OUT 50-ACTIVE-EXECUTION MATRIX ===\n'
rm -rf "$EVIDENCE_DIR/signed-out-results"
KOVA_RELEASE_AUTHENTICATED=0 \
PLAYWRIGHT_BASE_URL="$BASE_URL" \
npx playwright test tests/release-browser/final-matrix.spec.ts \
  --config=playwright.release.config.ts \
  --workers=3 \
  --retries=0 \
  --max-failures=1 \
  --output="$EVIDENCE_DIR/signed-out-results"
cp artifacts/release/browser-matrix-signed-out.xml \
  "$EVIDENCE_DIR/browser-matrix-signed-out.xml"

gate signed-out-counts env MATRIX_XML="$EVIDENCE_DIR/browser-matrix-signed-out.xml" \
  EXPECTED_ACTIVE=50 node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const xml = readFileSync(process.env.MATRIX_XML, "utf8");
const count = (pattern) => (xml.match(pattern) ?? []).length;
const tests = count(/<testcase\b/gu);
const skipped = count(/<skipped\b/gu);
const failures = count(/<failure\b/gu) + count(/<error\b/gu);
const active = tests - skipped;
assert.equal(failures, 0);
assert.equal(active, Number(process.env.EXPECTED_ACTIVE));
console.log(JSON.stringify({ tests, skipped, active, failures }));
NODE

printf '\n=== 7. PRIVATE SIGNED-IN STATE ===\n'
export KOVA_MATRIX_BASE_URL="$BASE_URL"
export KOVA_RELEASE_AUTH_STATE="$AUTH_STATE"

validate_auth_state() {
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = new URL(process.env.KOVA_MATRIX_BASE_URL);
const state = JSON.parse(readFileSync(process.env.KOVA_RELEASE_AUTH_STATE, "utf8"));
const origin = state.origins?.find((item) => item.origin === base.origin);
assert.ok(origin, "storage state does not contain the local preview origin");
const tokenItem = origin.localStorage?.find((item) => /^sb-.*-auth-token$/u.test(item.name));
assert.ok(tokenItem, "storage state does not contain a Supabase session");
const outer = JSON.parse(tokenItem.value);
const session = outer.currentSession ?? outer.session ?? outer;
assert.equal(typeof session.access_token, "string");
assert.ok(session.access_token.length > 100);
assert.equal(typeof session.refresh_token, "string");
assert.ok(session.user && typeof session.user.id === "string");
console.log("PRIVATE_AUTH_STATE=VALID");
NODE
}

if [ -f "$AUTH_STATE" ] && validate_auth_state >"$LOG_DIR/auth-state-validation.log" 2>&1; then
  chmod 600 "$AUTH_STATE"
  cat "$LOG_DIR/auth-state-validation.log"
  echo "AUTH_CAPTURE=REUSED_SECURE_PRIVATE_STATE"
else
  rm -f "$AUTH_STATE"
  cat <<EOF
A Chromium window will open at the local KovaGPT sign-in page.
Sign in with a disposable/rehearsal account using email + password.
Do not use a production administrator account.
The session is stored only at:
  $AUTH_STATE
EOF
  node --input-type=module <<'NODE'
import { chmod } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = new URL(process.env.KOVA_MATRIX_BASE_URL);
const output = process.env.KOVA_RELEASE_AUTH_STATE;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(`${base.origin}/auth`, { waitUntil: "domcontentloaded" });
console.log("AUTH_WINDOW_READY=YES");
console.log("Complete sign-in in the opened browser window. Timeout: 10 minutes.");

const deadline = Date.now() + 10 * 60_000;
let authenticated = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(750);
  const session = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const name = localStorage.key(index);
      if (!name || !/^sb-.*-auth-token$/u.test(name)) continue;
      try {
        const outer = JSON.parse(localStorage.getItem(name) ?? "null");
        const value = outer?.currentSession ?? outer?.session ?? outer;
        if (
          typeof value?.access_token === "string" &&
          typeof value?.refresh_token === "string" &&
          typeof value?.user?.id === "string"
        ) {
          return true;
        }
      } catch {
        // Ignore unrelated or partially-written localStorage entries.
      }
    }
    return false;
  }).catch(() => false);
  if (session) {
    authenticated = true;
    break;
  }
}

if (!authenticated) {
  await browser.close();
  throw new Error("Timed out waiting for a valid local Supabase session.");
}
await context.storageState({ path: output });
await chmod(output, 0o600);
await browser.close();
console.log("PRIVATE_AUTH_STATE=CAPTURED");
NODE
  validate_auth_state
fi

printf '\n=== 8. SIGNED-IN 50-ACTIVE-EXECUTION MATRIX ===\n'
rm -rf "$EVIDENCE_DIR/signed-in-results"
KOVA_RELEASE_AUTHENTICATED=1 \
KOVA_RELEASE_AUTH_STATE="$AUTH_STATE" \
PLAYWRIGHT_BASE_URL="$BASE_URL" \
npx playwright test tests/release-browser/final-matrix.spec.ts \
  --config=playwright.release.config.ts \
  --workers=3 \
  --retries=0 \
  --max-failures=1 \
  --output="$EVIDENCE_DIR/signed-in-results"
cp artifacts/release/browser-matrix-signed-in.xml \
  "$EVIDENCE_DIR/browser-matrix-signed-in.xml"

gate signed-in-counts env MATRIX_XML="$EVIDENCE_DIR/browser-matrix-signed-in.xml" \
  EXPECTED_ACTIVE=50 node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const xml = readFileSync(process.env.MATRIX_XML, "utf8");
const count = (pattern) => (xml.match(pattern) ?? []).length;
const tests = count(/<testcase\b/gu);
const skipped = count(/<skipped\b/gu);
const failures = count(/<failure\b/gu) + count(/<error\b/gu);
const active = tests - skipped;
assert.equal(failures, 0);
assert.equal(active, Number(process.env.EXPECTED_ACTIVE));
console.log(JSON.stringify({ tests, skipped, active, failures }));
NODE

printf '\n=== 9. WRITE NON-SECRET EXACT-SHA EVIDENCE ===\n'
export KOVA_MATRIX_SOURCE_SHA="$SOURCE_SHA"
export KOVA_MATRIX_SOURCE_TREE="$SOURCE_TREE"
export KOVA_MATRIX_EVIDENCE_DIR="$EVIDENCE_DIR"
export KOVA_MATRIX_SHORT_SHA="$SHORT_SHA"
node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const directory = process.env.KOVA_MATRIX_EVIDENCE_DIR;
const digest = async (name) =>
  createHash("sha256").update(await readFile(`${directory}/${name}`)).digest("hex");
const evidence = {
  schemaVersion: 1,
  gate: "local_visual_runtime_matrix",
  verifiedAt: new Date().toISOString(),
  sourceSha: process.env.KOVA_MATRIX_SOURCE_SHA,
  sourceTree: process.env.KOVA_MATRIX_SOURCE_TREE,
  buildIdentityVerified: true,
  webkitRuntimeDiagnostic: {
    passed: true,
    sha256: await digest("webkit-runtime-diagnostic.json"),
  },
  signedOut: {
    activeExecutions: 50,
    failures: 0,
    sha256: await digest("browser-matrix-signed-out.xml"),
  },
  signedIn: {
    activeExecutions: 50,
    failures: 0,
    sha256: await digest("browser-matrix-signed-in.xml"),
  },
  totalActiveExecutions: 100,
  authStateCommitted: false,
  productionClaim: false,
};
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/summary.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`LOCAL_MATRIX_EVIDENCE=${directory}/summary.json`);
NODE

printf '\n=== 10. PROMOTE THE FINAL SOURCE GATE ===\n'
DOC_EVIDENCE="docs/day16/LOCAL_VISUAL_RUNTIME_MATRIX_${SHORT_SHA}.json"
export KOVA_MATRIX_DOC_EVIDENCE="$DOC_EVIDENCE"
node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const sourceSha = process.env.KOVA_MATRIX_SOURCE_SHA;
const sourceTree = process.env.KOVA_MATRIX_SOURCE_TREE;
const rawSummary = readFileSync(`${process.env.KOVA_MATRIX_EVIDENCE_DIR}/summary.json`, "utf8");
const summary = JSON.parse(rawSummary);
const publicEvidence = {
  schemaVersion: 1,
  gate: summary.gate,
  verifiedAt: summary.verifiedAt,
  testedSourceSha: sourceSha,
  testedSourceTree: sourceTree,
  buildIdentityVerified: true,
  webkitRuntimeDiagnosticPassed: true,
  signedOutActiveExecutions: 50,
  signedInActiveExecutions: 50,
  totalActiveExecutions: 100,
  failures: 0,
  rawEvidenceSha256: createHash("sha256").update(rawSummary).digest("hex"),
  privateAuthStateExcluded: true,
  productionClaim: false,
};
writeFileSync(process.env.KOVA_MATRIX_DOC_EVIDENCE, `${JSON.stringify(publicEvidence, null, 2)}\n`);

const ledgerPath = "docs/day16/MASTER_LEDGER.json";
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const item = ledger.items.find((entry) => entry.id === "local_visual_runtime_matrix");
if (!item) throw new Error("local_visual_runtime_matrix ledger item is missing");
if (!["in_progress", "verified_local"].includes(item.status)) {
  throw new Error(`unexpected local visual gate status: ${item.status}`);
}
item.status = "verified_local";
item.evidence = [
  `Exact local source SHA ${sourceSha}`,
  `Exact local source tree ${sourceTree}`,
  "Exact-SHA Node/Azure production build identity verified",
  "WebKit hydration/runtime diagnostic passed with zero fatal events",
  "Signed-out Chromium, Firefox and WebKit matrix: 50 active executions, 0 failures",
  "Signed-in Chromium, Firefox and WebKit matrix: 50 active executions, 0 failures",
  process.env.KOVA_MATRIX_DOC_EVIDENCE,
];
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log("LOCAL_VISUAL_RUNTIME_MATRIX_LEDGER=VERIFIED_LOCAL");
NODE

node_modules/.bin/prettier --write docs/day16/MASTER_LEDGER.json "$DOC_EVIDENCE"
node scripts/release/day16-ledger.mjs | tee "$EVIDENCE_DIR/day16-ledger-after.json"
node scripts/release/remaining-work.mjs --write

git diff --check
CHANGED="$(git diff --name-only | sort)"
EXPECTED_CHANGED="$(printf '%s\n' docs/day16/MASTER_LEDGER.json "$DOC_EVIDENCE" | sort)"
[ "$CHANGED" = "$EXPECTED_CHANGED" ] || {
  echo "EXPECTED_CHANGED:"
  printf '%s\n' "$EXPECTED_CHANGED"
  echo "ACTUAL_CHANGED:"
  printf '%s\n' "$CHANGED"
  fail UNEXPECTED_LEDGER_PROMOTION_SCOPE
}

printf '\n=== 11. COMMIT AND PUSH THE EARNED GATE PROMOTION ===\n'
git add -- docs/day16/MASTER_LEDGER.json "$DOC_EVIDENCE"
git diff --cached --check
git commit -m "test: verify exact-SHA local visual runtime matrix [skip actions] [skip ci]"
EVIDENCE_COMMIT_SHA="$(git rev-parse HEAD)"

git fetch origin "$BRANCH"
[ "$(git rev-parse "origin/$BRANCH")" = "$SOURCE_SHA" ] || fail REMOTE_MOVED_DURING_MATRIX
git push origin "$BRANCH"

printf '\n============================================================\n'
printf ' KOVAGPT_LOCAL_VISUAL_RUNTIME_MATRIX=PASS\n'
printf ' TESTED_SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf ' TESTED_SOURCE_TREE=%s\n' "$SOURCE_TREE"
printf ' EVIDENCE_COMMIT_SHA=%s\n' "$EVIDENCE_COMMIT_SHA"
printf ' ACTIVE_EXECUTIONS=100\n'
printf ' SOURCE_GATES=13/13\n'
printf ' VERIFIED_HIGH_LEVEL_GATES=13/30\n'
printf ' REMAINING_HIGH_LEVEL_GATES=17\n'
printf ' PRODUCTION_GATES=0/17\n'
printf ' FULL_BROWSER_MATRIX_RUN=YES_LOCAL_ONLY\n'
printf ' PRODUCTION_CLAIM=NO\n'
printf ' GITHUB_ACTIONS_REQUESTED=0\n'
printf ' AZURE_DEPLOYMENTS=0\n'
printf ' LOVABLE_CREDITS_USED=0\n'
printf '============================================================\n'