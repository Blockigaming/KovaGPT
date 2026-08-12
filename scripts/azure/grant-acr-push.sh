#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  AZURE_CLIENT_ID=<github-oidc-application-client-id> \
    bash scripts/azure/grant-acr-push.sh [--apply]

Without --apply, this script is read-only and reports whether the GitHub OIDC
service principal already has AcrPush on the target Azure Container Registry.
The role assignment itself has no GitHub Actions cost, but --apply requires an
Azure identity authorized to create role assignments.
USAGE
}

apply=false
case "${1:-}" in
  "") ;;
  --apply) apply=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

: "${AZURE_CLIENT_ID:?Set AZURE_CLIENT_ID to the GitHub OIDC application client ID}"
ACR_NAME="${ACR_NAME:-kovagptacr}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-kovagpt-dev}"

command -v az >/dev/null 2>&1 || {
  echo "Azure CLI (az) is required." >&2
  exit 1
}

az account show --query '{subscription:id,tenant:tenantId,user:user.name}' --output json >/dev/null
acr_id="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id --output tsv)"
principal_id="$(az ad sp show --id "$AZURE_CLIENT_ID" --query id --output tsv)"

if [[ -z "$acr_id" || -z "$principal_id" ]]; then
  echo "Unable to resolve the registry or service principal." >&2
  exit 1
fi

assignment_count="$(az role assignment list \
  --assignee-object-id "$principal_id" \
  --scope "$acr_id" \
  --query "[?roleDefinitionName=='AcrPush'] | length(@)" \
  --output tsv)"

if [[ "$assignment_count" != "0" ]]; then
  echo "AcrPush is already assigned at the registry scope."
  exit 0
fi

if [[ "$apply" != "true" ]]; then
  echo "AcrPush is missing. Re-run with --apply from an authorized Azure shell."
  exit 3
fi

az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "$acr_id" \
  --output none

echo "AcrPush assigned. Allow Azure RBAC propagation before manually dispatching deployment."
