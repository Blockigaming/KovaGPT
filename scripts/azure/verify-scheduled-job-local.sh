#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
for command in az node; do command -v "$command" >/dev/null || fail "$command is required"; done
: "${KOVA_AZURE_RESOURCE_GROUP:?KOVA_AZURE_RESOURCE_GROUP is required}"
: "${KOVA_AZURE_CONTAINER_APP:?KOVA_AZURE_CONTAINER_APP is required}"
: "${KOVA_AZURE_SCHEDULED_JOB:?KOVA_AZURE_SCHEDULED_JOB is required}"
: "${KOVA_SCHEDULER_ENVIRONMENT:?KOVA_SCHEDULER_ENVIRONMENT must be staging or production}"
[[ "$KOVA_SCHEDULER_ENVIRONMENT" == "staging" || "$KOVA_SCHEDULER_ENVIRONMENT" == "production" ]] || \
  fail "KOVA_SCHEDULER_ENVIRONMENT must be staging or production"

RUN_CANARY="${KOVA_SCHEDULER_RUN_CANARY:-0}"
[[ "$RUN_CANARY" == "0" || "$RUN_CANARY" == "1" ]] || fail "KOVA_SCHEDULER_RUN_CANARY must be 0 or 1"
EVIDENCE="${KOVA_SCHEDULER_EVIDENCE_PATH:-artifacts/release/day16-azure-scheduler.json}"
mkdir -p "$(dirname "$EVIDENCE")"

JOB_JSON="$(az containerapp job show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_SCHEDULED_JOB" -o json)"
APP_IMAGE="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv)"

STRUCTURE="$(node --input-type=module - "$JOB_JSON" <<'NODE'
const job = JSON.parse(process.argv[2]);
const configuration = job.properties?.configuration ?? {};
const container = job.properties?.template?.containers?.[0] ?? {};
const env = Object.fromEntries((container.env ?? []).map((entry) => [entry.name, entry.value ?? `secret:${entry.secretRef ?? ''}`]));
const secrets = (configuration.secrets ?? []).map((entry) => entry.name).sort();
process.stdout.write(JSON.stringify({
  trigger: configuration.triggerType ?? '',
  cron: configuration.scheduleTriggerConfig?.cronExpression ?? '',
  image: container.image ?? '',
  command: container.command ?? [],
  args: container.args ?? [],
  env,
  secrets,
}));
NODE
)"

STRUCTURE_VALUES="$(node --input-type=module - "$STRUCTURE" <<'NODE'
const value = JSON.parse(process.argv[2]);
process.stdout.write([
  value.trigger,
  value.cron,
  value.image,
  JSON.stringify(value.command),
  JSON.stringify(value.args),
  value.env.KOVA_SCHEDULED_WORKER_ENABLED ?? '',
  value.env.KOVA_SCHEDULED_WORKER_ENVIRONMENT ?? '',
  value.env.KOVA_SOURCE_SHA ?? '',
  value.env.KOVA_WORKER_REVISION ?? '',
  value.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  value.env.KOVA_IP_HASH_SECRET ?? '',
  JSON.stringify(value.secrets),
].join('\t'));
NODE
)"

IFS=$'\t' read -r \
  TRIGGER CRON JOB_IMAGE COMMAND_JSON ARGS_JSON WORKER_ENABLED WORKER_ENVIRONMENT \
  SOURCE_SHA WORKER_REVISION SUPABASE_SECRET_REF IP_HASH_SECRET_REF SECRETS_JSON \
  <<< "$STRUCTURE_VALUES"

[[ "$TRIGGER" == "Schedule" ]] || fail "job trigger is not Schedule"
[[ -n "$CRON" ]] || fail "job cron expression is missing"
[[ "$JOB_IMAGE" == "$APP_IMAGE" ]] || fail "scheduled job and web app do not use the same immutable image"
[[ "$JOB_IMAGE" == *@sha256:* ]] || fail "scheduled job image is not immutable"
[[ "$COMMAND_JSON" == '["node"]' ]] || fail "scheduled job command is not the dedicated Node worker"
[[ "$ARGS_JSON" == '["dist/worker/scheduled-v2.mjs"]' ]] || fail "scheduled job does not execute dist/worker/scheduled-v2.mjs"
[[ "$WORKER_ENABLED" == "1" ]] || fail "scheduled worker enable flag is not explicit"
[[ "$WORKER_ENVIRONMENT" == "$KOVA_SCHEDULER_ENVIRONMENT" ]] || fail "scheduled worker environment does not match verification target"
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "scheduled job source SHA is not exact"
[[ "$WORKER_REVISION" == "$SOURCE_SHA" ]] || fail "scheduled worker revision is not pinned to the exact source SHA"
[[ "$SUPABASE_SECRET_REF" == "secret:supabase-service-role-key" ]] || fail "scheduled worker service-role secret binding is missing"
[[ "$IP_HASH_SECRET_REF" == "secret:kova-ip-hash-secret" ]] || fail "scheduled worker IP-hash secret binding is missing"
[[ "$SECRETS_JSON" == *'"supabase-service-role-key"'* ]] || fail "scheduled job service-role Key Vault secret is missing"
[[ "$SECRETS_JSON" == *'"kova-ip-hash-secret"'* ]] || fail "scheduled job IP-hash Key Vault secret is missing"
[[ "$SECRETS_JSON" != *'"scheduled-execution-secret"'* ]] || fail "obsolete HTTP scheduler secret is still mounted into the job"

if [[ -n "${KOVA_EXPECTED_SOURCE_SHA:-}" && "$SOURCE_SHA" != "$KOVA_EXPECTED_SOURCE_SHA" ]]; then
  fail "scheduled job source SHA does not match KOVA_EXPECTED_SOURCE_SHA"
fi

EXECUTION=""
STATUS="not-run"
START=""
END=""
if [[ "$RUN_CANARY" == "1" ]]; then
  EXECUTION="$(az containerapp job start -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_SCHEDULED_JOB" --query name -o tsv)"
  [[ -n "$EXECUTION" ]] || fail "Azure did not return a job execution name"
  STATUS=""
  for _ in {1..90}; do
    EXECUTIONS="$(az containerapp job execution list -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_SCHEDULED_JOB" -o json)"
    EXECUTION_VALUES="$(node --input-type=module - "$EXECUTIONS" "$EXECUTION" <<'NODE'
const [raw, name] = process.argv.slice(2);
const row = JSON.parse(raw).find((item) => item.name === name);
process.stdout.write([row?.properties?.status ?? '', row?.properties?.startTime ?? '', row?.properties?.endTime ?? ''].join('\t'));
NODE
)"
    STATUS="${EXECUTION_VALUES%%$'\t'*}"
    REST="${EXECUTION_VALUES#*$'\t'}"
    START="${REST%%$'\t'*}"
    END="${REST#*$'\t'}"
    [[ "$STATUS" == "Succeeded" ]] && break
    [[ "$STATUS" == "Failed" ]] && fail "scheduler canary execution failed"
    sleep 5
  done
  [[ "$STATUS" == "Succeeded" ]] || fail "scheduler canary did not succeed before timeout"
fi

node --input-type=module - \
  "$EVIDENCE" "$KOVA_AZURE_SCHEDULED_JOB" "$EXECUTION" "$STATUS" "$START" "$END" \
  "$CRON" "$JOB_IMAGE" "$SOURCE_SHA" "$WORKER_ENVIRONMENT" "$RUN_CANARY" <<'NODE'
import { writeFileSync } from 'node:fs';
const [
  path,
  job,
  execution,
  status,
  start,
  end,
  cron,
  image,
  sourceSha,
  environment,
  canary,
] = process.argv.slice(2);
writeFileSync(path, `${JSON.stringify({
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  job,
  execution: execution || null,
  status,
  start: start || null,
  end: end || null,
  cron,
  image,
  sourceSha,
  environment,
  command: ['node'],
  args: ['dist/worker/scheduled-v2.mjs'],
  canaryRun: canary === '1',
}, null, 2)}\n`);
NODE

echo "KOVA_AZURE_SCHEDULER_VERIFICATION=PASS source_sha=$SOURCE_SHA canary=$RUN_CANARY evidence=$EVIDENCE"
