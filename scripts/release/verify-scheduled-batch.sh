#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
if [ "$(git branch --show-current)" != "finalization/checkpoint-2026-08-28" ]; then
  echo "STOP=WRONG_BRANCH"
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=TRACKED_OR_STAGED_CHANGES"
  git status --short --branch
  exit 1
fi

SOURCE_SHA="$(git rev-parse HEAD)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kova-scheduled-batch.XXXXXX")"

gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@" >"$LOG_DIR/$name.log" 2>&1; then
    printf '%s=PASS\n' "$name"
    tail -n 10 "$LOG_DIR/$name.log"
  else
    local code=$?
    printf '%s=FAIL\n' "$name"
    tail -n 180 "$LOG_DIR/$name.log"
    printf 'LOG_DIRECTORY=%s\n' "$LOG_DIR"
    exit "$code"
  fi
}

for tool in eslint tsc; do
  if [ ! -x "node_modules/.bin/$tool" ]; then
    printf 'STOP=MISSING_LOCAL_TOOL_%s\n' "$tool"
    exit 1
  fi
done

printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"
gate syntax node --check tests/unit/scheduled-batch-safety.test.mjs
gate lint node_modules/.bin/eslint \
  src/lib/scheduled-execution.server.ts tests/unit/scheduled-batch-safety.test.mjs
gate typecheck node_modules/.bin/tsc --noEmit

gate scheduler-regressions node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

assert.match(
  readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8"),
  /export const scheduledExecutionAvailable = false;/u,
  "This safety patch must not enable scheduled execution.",
);
const paths = ["tests/unit", "tests/integration"].flatMap((directory) =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".test.mjs") && /scheduled|scheduler|day14/iu.test(name))
    .map((name) => `${directory}/${name}`),
).sort();
assert.ok(paths.includes("tests/unit/scheduled-batch-safety.test.mjs"));
console.log(`SCHEDULER_TEST_FILES=${paths.length}`);
const result = spawnSync(process.execPath, ["--test", ...paths], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
NODE

git diff --check
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "STOP=VALIDATION_CHANGED_TRACKED_FILES"
  git status --short --branch
  exit 1
fi
printf '\nKOVAGPT_SCHEDULED_BATCH_SAFETY=PASS\n'
printf 'SOURCE_SHA=%s\nLOG_DIRECTORY=%s\n' "$SOURCE_SHA" "$LOG_DIR"
printf 'SCHEDULER_ENABLED=NO\nDATABASE_MIGRATIONS_APPLIED=0\n'
printf 'BUILD_RUN=NO\nBROWSER_MATRIX_RUN=NO\nLEDGER_PROMOTED=NO\nPUSHED=NO\n'
printf 'GITHUB_ACTIONS_DISPATCHED=0\nAZURE_DEPLOYMENTS=0\nLOVABLE_CREDITS_USED=0\n'
