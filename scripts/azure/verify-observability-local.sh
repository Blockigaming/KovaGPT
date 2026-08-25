#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
for command in az node; do command -v "$command" >/dev/null || fail "$command is required"; done
: "${KOVA_AZURE_RESOURCE_GROUP:?KOVA_AZURE_RESOURCE_GROUP is required}"
: "${KOVA_AZURE_APP_INSIGHTS:?KOVA_AZURE_APP_INSIGHTS is required}"
EVIDENCE="${KOVA_OBSERVABILITY_EVIDENCE_PATH:-artifacts/release/day16-azure-observability.json}"
mkdir -p "$(dirname "$EVIDENCE")"

COMPONENT="$(az monitor app-insights component show -g "$KOVA_AZURE_RESOURCE_GROUP" --app "$KOVA_AZURE_APP_INSIGHTS" -o json)"
CONNECTION_PRESENT="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.connectionString ? "true" : "false")' "$COMPONENT")"
[[ "$CONNECTION_PRESENT" == "true" ]] || fail "Application Insights connection string is unavailable"
QUERY='requests | where timestamp > ago(30m) | summarize total=count(), failed=countif(success == false), health=countif(url endswith "/api/health" or url endswith "/api/livez" or url endswith "/api/readyz")'
RESULT="$(az monitor app-insights query -g "$KOVA_AZURE_RESOURCE_GROUP" --app "$KOVA_AZURE_APP_INSIGHTS" --analytics-query "$QUERY" -o json)"
node --input-type=module - "$RESULT" <<'NODE'
const result = JSON.parse(process.argv[2]);
const table = result.tables?.[0];
if (!table || !Array.isArray(table.rows) || table.rows.length !== 1) throw new Error('observability query returned no table');
const [total, failed, health] = table.rows[0].map(Number);
if (!Number.isFinite(total) || total < 1) throw new Error('no recent request telemetry');
if (!Number.isFinite(health) || health < 1) throw new Error('no recent health telemetry');
if (!Number.isFinite(failed)) throw new Error('failed request metric is invalid');
NODE

node --input-type=module - "$EVIDENCE" "$RESULT" <<'NODE'
import { writeFileSync } from 'node:fs';
const [path, raw] = process.argv.slice(2);
const result = JSON.parse(raw);
const table = result.tables[0];
const [total, failed, health] = table.rows[0].map(Number);
writeFileSync(path, `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  windowMinutes: 30,
  requests: total,
  failedRequests: failed,
  healthRequests: health,
}, null, 2)}\n`);
NODE

echo "KOVA_AZURE_OBSERVABILITY_VERIFICATION=PASS evidence=$EVIDENCE"
