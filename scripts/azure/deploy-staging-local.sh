#!/usr/bin/env bash
set -euo pipefail
# Immutable Azure deployment image format: registry/repository@sha256:<64-hex-digest>
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
require_env() { [[ -n "${!1:-}" ]] || fail "$1 is required"; }

for command in git node npm docker az; do command -v "$command" >/dev/null || fail "$command is required"; done
for name in \
  KOVA_AZURE_STAGING_RESOURCE_GROUP \
  KOVA_AZURE_STAGING_CONTAINER_APP \
  KOVA_AZURE_ACR_NAME \
  KOVA_AZURE_IMAGE_REPOSITORY \
  KOVA_STAGING_PARAMETERS \
  KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF \
  VITE_SUPABASE_URL \
  VITE_SUPABASE_PUBLISHABLE_KEY \
  KOVA_READINESS_TOKEN; do require_env "$name"; done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SHA="$(git rev-parse HEAD)"
TREE="$(git rev-parse HEAD^{tree})"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || fail "HEAD is not a full SHA"
[[ "$(git branch --show-current)" == "main" ]] || fail "staging must deploy from main"
[[ -z "$(git status --porcelain)" ]] || fail "repository must be clean"
[[ "${KOVA_STAGING_DEPLOY_CONFIRMATION:-}" == "STAGE $SHA" ]] || fail "set KOVA_STAGING_DEPLOY_CONFIRMATION='STAGE $SHA'"
[[ -f "$KOVA_STAGING_PARAMETERS" ]] || fail "staging parameter file not found"
[[ "$KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "staging Supabase project ref is invalid"
[[ "$KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF" != "${KOVA_EXPECTED_SUPABASE_PROJECT_REF:-}" ]] || fail "staging and production Supabase project refs must differ"
[[ "$VITE_SUPABASE_URL" == "https://${KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co" ]] || fail "VITE_SUPABASE_URL does not match staging"

docker info >/dev/null
az account show >/dev/null
az bicep build --file infra/azure/staging/main.bicep --stdout >/dev/null

EVIDENCE_DIR="${KOVA_RELEASE_EVIDENCE_DIR:-artifacts/release/day16-staging-${SHA}}"
mkdir -p "$EVIDENCE_DIR"

npm ci --no-audit --no-fund
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:api
npm run test:integration
npm run release:day16:source

az acr login --name "$KOVA_AZURE_ACR_NAME" >/dev/null
LOGIN_SERVER="$(az acr show --name "$KOVA_AZURE_ACR_NAME" --query loginServer -o tsv)"
TAG_IMAGE="${LOGIN_SERVER}/${KOVA_AZURE_IMAGE_REPOSITORY}:${SHA}-staging"
docker build --pull \
  --build-arg "KOVA_SOURCE_SHA=$SHA" \
  --build-arg "KOVA_SOURCE_TREE=$TREE" \
  --build-arg "KOVA_EXPECTED_SUPABASE_PROJECT_REF=$KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF" \
  --build-arg "KOVA_VERIFY_BROWSER_CONFIG=true" \
  --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --tag "$TAG_IMAGE" .
docker push "$TAG_IMAGE"
DIGEST="$(az acr manifest show-metadata --registry "$KOVA_AZURE_ACR_NAME" --name "${KOVA_AZURE_IMAGE_REPOSITORY}:${SHA}-staging" --query digest -o tsv)"
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "ACR did not return an immutable staging digest"
IMAGE_REFERENCE="${LOGIN_SERVER}/${KOVA_AZURE_IMAGE_REPOSITORY}@${DIGEST}"

az deployment group what-if \
  --resource-group "$KOVA_AZURE_STAGING_RESOURCE_GROUP" \
  --template-file infra/azure/staging/main.bicep \
  --parameters "@$KOVA_STAGING_PARAMETERS" \
  --parameters imageReference="$IMAGE_REFERENCE" sourceSha="$SHA" sourceTree="$TREE" expectedSupabaseProjectRef="$KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF" \
  --only-show-errors
[[ "${KOVA_AZURE_STAGING_WHAT_IF_APPROVED:-}" == "APPROVED STAGING $SHA" ]] || fail "review what-if, then set KOVA_AZURE_STAGING_WHAT_IF_APPROVED='APPROVED STAGING $SHA'"

DEPLOYMENT_NAME="kovagpt-staging-${SHA:0:12}-$(date -u +%Y%m%d%H%M%S)"
az deployment group create \
  --name "$DEPLOYMENT_NAME" \
  --resource-group "$KOVA_AZURE_STAGING_RESOURCE_GROUP" \
  --template-file infra/azure/staging/main.bicep \
  --parameters "@$KOVA_STAGING_PARAMETERS" \
  --parameters imageReference="$IMAGE_REFERENCE" sourceSha="$SHA" sourceTree="$TREE" expectedSupabaseProjectRef="$KOVA_EXPECTED_STAGING_SUPABASE_PROJECT_REF" \
  --only-show-errors \
  --output json > "$EVIDENCE_DIR/deployment-result.json"

REVISION="$(az containerapp show -g "$KOVA_AZURE_STAGING_RESOURCE_GROUP" -n "$KOVA_AZURE_STAGING_CONTAINER_APP" --query properties.latestReadyRevisionName -o tsv)"
[[ -n "$REVISION" ]] || fail "Azure did not report a staging revision"
for _ in {1..60}; do
  STATE="$(az containerapp revision show -g "$KOVA_AZURE_STAGING_RESOURCE_GROUP" -n "$KOVA_AZURE_STAGING_CONTAINER_APP" --revision "$REVISION" --query '[properties.healthState,properties.runningState]' -o tsv 2>/dev/null || true)"
  if grep -q 'Healthy' <<<"$STATE" && grep -q 'Running' <<<"$STATE"; then break; fi
  sleep 5
done
STATE="$(az containerapp revision show -g "$KOVA_AZURE_STAGING_RESOURCE_GROUP" -n "$KOVA_AZURE_STAGING_CONTAINER_APP" --revision "$REVISION" --query '[properties.healthState,properties.runningState]' -o tsv)"
grep -q 'Healthy' <<<"$STATE" && grep -q 'Running' <<<"$STATE" || fail "staging revision is not healthy"
LIVE_IMAGE="$(az containerapp show -g "$KOVA_AZURE_STAGING_RESOURCE_GROUP" -n "$KOVA_AZURE_STAGING_CONTAINER_APP" --query 'properties.template.containers[0].image' -o tsv)"
[[ "$LIVE_IMAGE" == "$IMAGE_REFERENCE" ]] || fail "staging is not using the expected digest"
FQDN="$(az containerapp show -g "$KOVA_AZURE_STAGING_RESOURCE_GROUP" -n "$KOVA_AZURE_STAGING_CONTAINER_APP" --query properties.configuration.ingress.fqdn -o tsv)"
[[ -n "$FQDN" ]] || fail "staging ingress FQDN is unavailable"

KOVA_EXPECTED_SHA="$SHA" \
KOVA_EXPECTED_ENVIRONMENT=staging \
KOVA_PRODUCTION_BASE_URL="https://$FQDN" \
KOVA_REQUIRE_CLOUDFLARE=0 \
KOVA_PRODUCTION_EVIDENCE_PATH="$EVIDENCE_DIR/staging-system.json" \
npm run release:production:verify

node --input-type=module - "$EVIDENCE_DIR/azure-staging-deployment.json" "$SHA" "$TREE" "$IMAGE_REFERENCE" "$REVISION" "$DEPLOYMENT_NAME" "$FQDN" <<'NODE'
import { writeFileSync } from 'node:fs';
const [path, sourceSha, sourceTree, imageReference, revision, deploymentName, fqdn] = process.argv.slice(2);
writeFileSync(path, `${JSON.stringify({
  schemaVersion: 1,
  deployedAt: new Date().toISOString(),
  sourceSha,
  sourceTree,
  imageReference,
  revision,
  deploymentName,
  fqdn,
  environment: 'staging',
  githubActionsInvokedByScript: 0,
  lovableCreditsUsedByScript: 0,
}, null, 2)}\n`);
NODE

echo "KOVA_AZURE_STAGING_DEPLOYMENT=PASS sha=$SHA image=$IMAGE_REFERENCE revision=$REVISION"
