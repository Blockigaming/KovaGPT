#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
for command in az node; do command -v "$command" >/dev/null || fail "$command is required"; done
: "${KOVA_AZURE_RESOURCE_GROUP:?KOVA_AZURE_RESOURCE_GROUP is required}"
: "${KOVA_AZURE_CONTAINER_APP:?KOVA_AZURE_CONTAINER_APP is required}"
: "${KOVA_AZURE_SCHEDULED_JOB:?KOVA_AZURE_SCHEDULED_JOB is required}"
BASE_URL="${KOVA_PRODUCTION_BASE_URL:-https://kovagpt.com}"
EVIDENCE="${KOVA_SCHEDULER_EVIDENCE_PATH:-artifacts/release/day16-azure-scheduler.json}"
mkdir -p "$(dirname "$EVIDENCE")"

JOB_JSON="$(az containerapp job show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_SCHEDULED_JOB" -o json)"
TRIGGER="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.properties?.configuration?.triggerType ?? "")' "$JOB_JSON")"
CRON="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.properties?.configuration?.scheduleTriggerConfig?.cronExpression ?? "")' "$JOB_JSON")"
JOB_IMAGE="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.properties?.template?.containers?.[0]?.image ?? "")' "$JOB_JSON")"
APP_IMAGE="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv)"
[[ "$TRIGGER" == "Schedule" ]] || fail "job trigger is not Schedule"
[[ -n "$CRON" ]] || fail "job cron expression is missing"
[[ "$JOB_IMAGE" == "$APP_IMAGE" ]] || fail "scheduled job and web app do not use the same image"
[[ "$JOB_IMAGE" == *@sha256:* ]] || fail "scheduled job image is not immutable"

BAD_HTTP="$(node --input-type=module - "$BASE_URL" <<'NODE'
const base = new URL(process.argv[2]);
const response = await fetch(new URL('/api/internal/scheduled-execution', base), {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer definitely-invalid' },
  body: '{}',
  redirect: 'manual',
  signal: AbortSignal.timeout(20000),
});
process.stdout.write(String(response.status));
NODE
)"
[[ "$BAD_HTTP" == "401" ]] || fail "scheduler ingress invalid-auth boundary returned $BAD_HTTP"

EXECUTION="$(az containerapp job start -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_SCHEDULED_JOB" --query name -o tsv)"
[[ -n "$EXECUTION" ]] || fail "Azure did not return a job execution name"
STATUS=""
START=""
END=""
for _ in {1..90}; do
  EXECUTIONS="$(az containerapp job execution list -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_SCHEDULED_JOB" -o json)"
  VALUES="$(node --input-type=module - "$EXECUTIONS" "$EXECUTION" <<'NODE'
const [raw, name] = process.argv.slice(2);
const row = JSON.parse(raw).find((item) => item.name === name);
process.stdout.write([row?.properties?.status ?? '', row?.properties?.startTime ?? '', row?.properties?.endTime ?? ''].join('\t'));
NODE
)"
  STATUS="${VALUES%%$'\t'*}"
  REST="${VALUES#*$'\t'}"
  START="${REST%%$'\t'*}"
  END="${REST#*$'\t'}"
  [[ "$STATUS" == "Succeeded" ]] && break
  [[ "$STATUS" == "Failed" ]] && fail "scheduler canary execution failed"
  sleep 5
done
[[ "$STATUS" == "Succeeded" ]] || fail "scheduler canary did not succeed before timeout"

node --input-type=module - "$EVIDENCE" "$KOVA_AZURE_SCHEDULED_JOB" "$EXECUTION" "$STATUS" "$START" "$END" "$CRON" "$JOB_IMAGE" "$BAD_HTTP" <<'NODE'
import { writeFileSync } from 'node:fs';
const [path, job, execution, status, start, end, cron, image, badAuthStatus] = process.argv.slice(2);
writeFileSync(path, `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  job,
  execution,
  status,
  start,
  end,
  cron,
  image,
  invalidAuthStatus: Number(badAuthStatus),
}, null, 2)}\n`);
NODE

echo "KOVA_AZURE_SCHEDULER_VERIFICATION=PASS execution=$EXECUTION evidence=$EVIDENCE"
