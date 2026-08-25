#!/usr/bin/env bash
set -euo pipefail
# Immutable Azure deployment image format: registry/repository@sha256:<64-hex-digest>
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
require_env() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }

for command in git node npm docker az; do command -v "$command" >/dev/null || fail "$command is required"; done
for name in \
  KOVA_AZURE_RESOURCE_GROUP \
  KOVA_AZURE_CONTAINER_APP \
  KOVA_AZURE_ACR_NAME \
  KOVA_AZURE_IMAGE_REPOSITORY \
  KOVA_PRODUCTION_PARAMETERS \
  KOVA_EXPECTED_SUPABASE_PROJECT_REF \
  KOVA_PRODUCTION_BASE_URL \
  KOVA_PRODUCTION_ACCESS_TOKEN \
  KOVA_READINESS_TOKEN \
  CLOUDFLARE_ZONE_ID \
  CLOUDFLARE_API_TOKEN \
  VITE_SUPABASE_URL \
  VITE_SUPABASE_PUBLISHABLE_KEY; do require_env "$name"; done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SHA="$(git rev-parse HEAD)"
TREE="$(git rev-parse HEAD^{tree})"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || fail "HEAD is not a full SHA"
[[ "$(git branch --show-current)" == "main" ]] || fail "production must deploy from main"
[[ -z "$(git status --porcelain)" ]] || fail "repository must be clean"
[[ "${KOVA_PRODUCTION_DEPLOY_CONFIRMATION:-}" == "DEPLOY $SHA" ]] || fail "set KOVA_PRODUCTION_DEPLOY_CONFIRMATION='DEPLOY $SHA'"
[[ -f "$KOVA_PRODUCTION_PARAMETERS" ]] || fail "production parameter file not found"
[[ "$KOVA_EXPECTED_SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "expected Supabase project ref must be 20 lowercase letters/digits"
[[ "$VITE_SUPABASE_URL" == "https://${KOVA_EXPECTED_SUPABASE_PROJECT_REF}.supabase.co" ]] || fail "VITE_SUPABASE_URL does not match the expected project ref"
[[ "$KOVA_PRODUCTION_BASE_URL" =~ ^https://[^/]+$ ]] || fail "KOVA_PRODUCTION_BASE_URL must be one HTTPS origin without a path"

node --input-type=module - "$KOVA_PRODUCTION_PARAMETERS" "$KOVA_PRODUCTION_BASE_URL" <<'NODE'
import { readFileSync } from "node:fs";
const [path, baseUrl] = process.argv.slice(2);
const values = JSON.parse(readFileSync(path, "utf8")).parameters ?? {};
const read = (name) => values[name]?.value;
if (read("generationEnabled") !== true) throw new Error("final production parameters must enable generation");
if (read("bindCustomDomains") !== true) throw new Error("final production parameters must bind the custom domains");
if (read("deployScheduledJob") !== true) throw new Error("final production parameters must deploy the scheduled job");
if ((read("temporaryOriginVerificationCidrs") ?? []).length !== 0) throw new Error("final production parameters cannot retain origin bypass CIDRs");
if (read("publicBaseUrl") !== baseUrl) throw new Error("publicBaseUrl must exactly match KOVA_PRODUCTION_BASE_URL");
NODE

docker info >/dev/null
az account show >/dev/null
az bicep build --file infra/azure/production/main.bicep --stdout >/dev/null

EVIDENCE_DIR="${KOVA_RELEASE_EVIDENCE_DIR:-artifacts/release/day16-${SHA}}"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_PATH="$EVIDENCE_DIR/azure-production-deployment.json"

OLD_REVISION="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query properties.latestReadyRevisionName -o tsv 2>/dev/null || true)"
OLD_IMAGE="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)"
OLD_BUILD=""
if [[ -n "$OLD_REVISION" ]]; then
  OLD_BUILD="$(az containerapp revision show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --revision "$OLD_REVISION" --query 'properties.template.containers[0].env[?name==`KOVA_BUILD_SHA`].value | [0]' -o tsv 2>/dev/null || true)"
fi

printf '%s\n' "=== Local exact-source release gates ==="
npm ci --no-audit --no-fund
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:api
npm run test:integration
npm run test:a11y
npm run test:visual
npm run release:day16:source

printf '%s\n' "=== Build and push exact immutable image ==="
az acr login --name "$KOVA_AZURE_ACR_NAME" >/dev/null
LOGIN_SERVER="$(az acr show --name "$KOVA_AZURE_ACR_NAME" --query loginServer -o tsv)"
TAG_IMAGE="${LOGIN_SERVER}/${KOVA_AZURE_IMAGE_REPOSITORY}:${SHA}"
docker build --pull \
  --build-arg "KOVA_SOURCE_SHA=$SHA" \
  --build-arg "KOVA_SOURCE_TREE=$TREE" \
  --build-arg "KOVA_EXPECTED_SUPABASE_PROJECT_REF=$KOVA_EXPECTED_SUPABASE_PROJECT_REF" \
  --build-arg "KOVA_VERIFY_BROWSER_CONFIG=true" \
  --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --tag "$TAG_IMAGE" .
docker push "$TAG_IMAGE"
DIGEST="$(az acr manifest show-metadata --registry "$KOVA_AZURE_ACR_NAME" --name "${KOVA_AZURE_IMAGE_REPOSITORY}:${SHA}" --query digest -o tsv)"
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "ACR did not return an immutable digest"
IMAGE_REFERENCE="${LOGIN_SERVER}/${KOVA_AZURE_IMAGE_REPOSITORY}@${DIGEST}"

printf '%s\n' "=== Azure what-if ==="
az deployment group what-if \
  --resource-group "$KOVA_AZURE_RESOURCE_GROUP" \
  --template-file infra/azure/production/main.bicep \
  --parameters "@$KOVA_PRODUCTION_PARAMETERS" \
  --parameters imageReference="$IMAGE_REFERENCE" sourceSha="$SHA" sourceTree="$TREE" expectedSupabaseProjectRef="$KOVA_EXPECTED_SUPABASE_PROJECT_REF" \
  --only-show-errors

[[ "${KOVA_AZURE_WHAT_IF_APPROVED:-}" == "APPROVED $SHA" ]] || fail "review what-if, then set KOVA_AZURE_WHAT_IF_APPROVED='APPROVED $SHA'"

printf '%s\n' "=== Deploy exact release ==="
DEPLOYMENT_NAME="kovagpt-${SHA:0:12}-$(date -u +%Y%m%d%H%M%S)"
az deployment group create \
  --name "$DEPLOYMENT_NAME" \
  --resource-group "$KOVA_AZURE_RESOURCE_GROUP" \
  --template-file infra/azure/production/main.bicep \
  --parameters "@$KOVA_PRODUCTION_PARAMETERS" \
  --parameters imageReference="$IMAGE_REFERENCE" sourceSha="$SHA" sourceTree="$TREE" expectedSupabaseProjectRef="$KOVA_EXPECTED_SUPABASE_PROJECT_REF" \
  --only-show-errors \
  --output json > "$EVIDENCE_DIR/deployment-result.json"

OUTPUTS_JSON="$(node --input-type=module - "$EVIDENCE_DIR/deployment-result.json" <<'NODE'
import { readFileSync } from "node:fs";
const deployment = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(JSON.stringify(deployment.properties?.outputs ?? {}));
NODE
)"
read_output() { node -e 'const o=JSON.parse(process.argv[1]); const value=o[process.argv[2]]?.value; process.stdout.write(value == null ? "" : String(value));' "$OUTPUTS_JSON" "$1"; }
export KOVA_AZURE_CONTAINER_APP="$(read_output containerAppName)"
export KOVA_AZURE_ORIGIN_FQDN="$(read_output containerAppFqdn)"
export KOVA_AZURE_SCHEDULED_JOB="$(read_output scheduledJobName)"
export KOVA_AZURE_APP_INSIGHTS="$(read_output applicationInsightsName)"
export KOVA_AZURE_MANAGED_IDENTITY_RESOURCE_ID="$(read_output managedIdentityResourceId)"
export KOVA_AZURE_ACR_RESOURCE_ID="$(read_output acrResourceId)"
export KOVA_AZURE_KEY_VAULT_RESOURCE_ID="$(read_output keyVaultResourceId)"
export KOVA_AZURE_OPENAI_RESOURCE_ID="$(read_output azureOpenAiResourceId)"
[[ "$(read_output generationIsEnabled)" == "true" ]] || fail "deployed generation is not enabled"
[[ "$(read_output customDomainsBound)" == "true" ]] || fail "custom domains are not bound"
[[ "$(read_output temporaryOriginVerificationCidrsCount)" == "0" ]] || fail "temporary origin bypass CIDRs remain"
[[ -n "$KOVA_AZURE_SCHEDULED_JOB" ]] || fail "scheduled job was not deployed"
[[ -n "$KOVA_AZURE_APP_INSIGHTS" ]] || fail "Application Insights output is missing"
[[ -n "$KOVA_AZURE_ORIGIN_FQDN" ]] || fail "Azure origin FQDN output is missing"

NEW_REVISION="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query properties.latestReadyRevisionName -o tsv)"
[[ -n "$NEW_REVISION" ]] || fail "Azure did not report a ready revision"
for _ in {1..60}; do
  STATE="$(az containerapp revision show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --revision "$NEW_REVISION" --query '[properties.healthState,properties.runningState]' -o tsv 2>/dev/null || true)"
  if grep -q 'Healthy' <<<"$STATE" && grep -q 'Running' <<<"$STATE"; then break; fi
  sleep 5
done
STATE="$(az containerapp revision show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --revision "$NEW_REVISION" --query '[properties.healthState,properties.runningState]' -o tsv)"
grep -q 'Healthy' <<<"$STATE" && grep -q 'Running' <<<"$STATE" || fail "new Azure revision is not healthy and running"
LIVE_IMAGE="$(az containerapp show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv)"
[[ "$LIVE_IMAGE" == "$IMAGE_REFERENCE" ]] || fail "Azure is not using the expected image digest"

export KOVA_EXPECTED_SHA="$SHA"
export KOVA_REQUIRE_CLOUDFLARE=1
export KOVA_RUN_GENERATION_SMOKE=1
export KOVA_RUN_TOOL_SMOKE=1
export KOVA_RUN_RESEARCH_SMOKE=1
export KOVA_RUN_IMAGE_SMOKE=1
export KOVA_PRODUCTION_EVIDENCE_PATH="$EVIDENCE_DIR/production-system.json"
npm run release:production:verify

export KOVA_CLOUDFLARE_EVIDENCE_PATH="$EVIDENCE_DIR/cloudflare-edge.json"
npm run cloudflare:edge:verify

export KOVA_RBAC_EVIDENCE_PATH="$EVIDENCE_DIR/azure-rbac.json"
npm run azure:production:rbac:verify

export KOVA_SCHEDULER_EVIDENCE_PATH="$EVIDENCE_DIR/azure-scheduler.json"
npm run azure:production:scheduler:verify

export KOVA_OBSERVABILITY_EVIDENCE_PATH="$EVIDENCE_DIR/azure-observability.json"
npm run azure:production:observability:verify

node --input-type=module - "$EVIDENCE_PATH" "$SHA" "$TREE" "$IMAGE_REFERENCE" "$OLD_REVISION" "$OLD_IMAGE" "$OLD_BUILD" "$NEW_REVISION" "$DEPLOYMENT_NAME" <<'NODE'
import { writeFileSync } from "node:fs";
const [path, sourceSha, sourceTree, imageReference, oldRevision, oldImage, oldBuild, newRevision, deploymentName] = process.argv.slice(2);
writeFileSync(path, `${JSON.stringify({
  schemaVersion: 1,
  deployedAt: new Date().toISOString(),
  sourceSha,
  sourceTree,
  imageReference,
  deploymentName,
  newRevision,
  rollback: { oldRevision: oldRevision || null, oldImage: oldImage || null, oldBuild: oldBuild || null },
  githubActionsInvokedByScript: 0,
  lovableCreditsUsedByScript: 0,
}, null, 2)}\n`);
NODE

printf '\nKOVA_AZURE_PRODUCTION_DEPLOYMENT=PASS\nSOURCE_SHA=%s\nIMAGE=%s\nREVISION=%s\nEVIDENCE=%s\n' "$SHA" "$IMAGE_REFERENCE" "$NEW_REVISION" "$EVIDENCE_PATH"
