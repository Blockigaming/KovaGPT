#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
[[ $# -eq 1 ]] || fail "usage: $0 artifacts/release/.../azure-production-deployment.json"
EVIDENCE="$1"
[[ -f "$EVIDENCE" ]] || fail "deployment evidence file not found"
for command in node az; do command -v "$command" >/dev/null || fail "$command is required"; done
: "${KOVA_AZURE_RESOURCE_GROUP:?KOVA_AZURE_RESOURCE_GROUP is required}"
: "${KOVA_AZURE_CONTAINER_APP:?KOVA_AZURE_CONTAINER_APP is required}"

DEPLOYED_SHA="$(node --input-type=module - "$EVIDENCE" <<'NODE'
import { readFileSync } from "node:fs";
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(evidence.sourceSha ?? ""));
NODE
)"
OLD_IMAGE="$(node --input-type=module - "$EVIDENCE" <<'NODE'
import { readFileSync } from "node:fs";
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(evidence.rollback?.oldImage ?? ""));
NODE
)"
OLD_BUILD="$(node --input-type=module - "$EVIDENCE" <<'NODE'
import { readFileSync } from "node:fs";
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(evidence.rollback?.oldBuild ?? ""));
NODE
)"
[[ "$DEPLOYED_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "invalid deployment evidence"
[[ "$OLD_IMAGE" == *@sha256:* ]] || fail "evidence does not contain an immutable rollback image"
[[ "${KOVA_PRODUCTION_ROLLBACK_CONFIRMATION:-}" == "ROLLBACK $DEPLOYED_SHA" ]] || fail "set KOVA_PRODUCTION_ROLLBACK_CONFIRMATION='ROLLBACK $DEPLOYED_SHA'"

CURRENT_IMAGE="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv)"
[[ "$CURRENT_IMAGE" != "$OLD_IMAGE" ]] || { echo "Rollback image is already live."; exit 0; }

az containerapp update -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --image "$OLD_IMAGE" --only-show-errors -o none
REVISION="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query properties.latestReadyRevisionName -o tsv)"
for _ in {1..60}; do
  STATE="$(az containerapp revision show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --revision "$REVISION" --query '[properties.healthState,properties.runningState]' -o tsv 2>/dev/null || true)"
  if grep -q 'Healthy' <<<"$STATE" && grep -q 'Running' <<<"$STATE"; then break; fi
  sleep 5
done
STATE="$(az containerapp revision show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --revision "$REVISION" --query '[properties.healthState,properties.runningState]' -o tsv)"
grep -q 'Healthy' <<<"$STATE" && grep -q 'Running' <<<"$STATE" || fail "rollback revision is not healthy"
LIVE_IMAGE="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv)"
[[ "$LIVE_IMAGE" == "$OLD_IMAGE" ]] || fail "rollback image is not live"
if [[ "$OLD_BUILD" =~ ^[a-f0-9]{40}$ ]]; then
  KOVA_EXPECTED_SHA="$OLD_BUILD" npm run release:production:verify
fi
printf 'KOVA_AZURE_PRODUCTION_ROLLBACK=PASS\nREVISION=%s\nIMAGE=%s\n' "$REVISION" "$OLD_IMAGE"
