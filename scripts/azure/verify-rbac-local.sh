#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

fail() { echo "ERROR: $*" >&2; exit 1; }
for command in az node; do command -v "$command" >/dev/null || fail "$command is required"; done
[[ -n "${KOVA_AZURE_RESOURCE_GROUP:-}" ]] || fail "KOVA_AZURE_RESOURCE_GROUP is required"
EVIDENCE="${KOVA_RBAC_EVIDENCE_PATH:-artifacts/release/day16-azure-rbac.json}"
mkdir -p "$(dirname "$EVIDENCE")"

if [[ -n "${KOVA_AZURE_MANAGED_IDENTITY_RESOURCE_ID:-}" ]]; then
  PRINCIPAL="$(az identity show --ids "$KOVA_AZURE_MANAGED_IDENTITY_RESOURCE_ID" --query principalId -o tsv)"
else
  [[ -n "${KOVA_AZURE_MANAGED_IDENTITY:-}" ]] || fail "KOVA_AZURE_MANAGED_IDENTITY or KOVA_AZURE_MANAGED_IDENTITY_RESOURCE_ID is required"
  PRINCIPAL="$(az identity show -g "$KOVA_AZURE_RESOURCE_GROUP" -n "$KOVA_AZURE_MANAGED_IDENTITY" --query principalId -o tsv)"
fi
[[ "$PRINCIPAL" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "managed identity principal was not found"

if [[ -n "${KOVA_AZURE_ACR_RESOURCE_ID:-}" ]]; then
  ACR_ID="$KOVA_AZURE_ACR_RESOURCE_ID"
else
  [[ -n "${KOVA_AZURE_ACR_NAME:-}" ]] || fail "KOVA_AZURE_ACR_NAME or KOVA_AZURE_ACR_RESOURCE_ID is required"
  ACR_RG="${KOVA_AZURE_ACR_RESOURCE_GROUP:-$KOVA_AZURE_RESOURCE_GROUP}"
  ACR_ID="$(az acr show -g "$ACR_RG" -n "$KOVA_AZURE_ACR_NAME" --query id -o tsv)"
fi

if [[ -n "${KOVA_AZURE_KEY_VAULT_RESOURCE_ID:-}" ]]; then
  KV_ID="$KOVA_AZURE_KEY_VAULT_RESOURCE_ID"
else
  [[ -n "${KOVA_AZURE_KEY_VAULT:-}" ]] || fail "KOVA_AZURE_KEY_VAULT or KOVA_AZURE_KEY_VAULT_RESOURCE_ID is required"
  KV_RG="${KOVA_AZURE_KEY_VAULT_RESOURCE_GROUP:-$KOVA_AZURE_RESOURCE_GROUP}"
  KV_ID="$(az keyvault show -g "$KV_RG" -n "$KOVA_AZURE_KEY_VAULT" --query id -o tsv)"
fi

if [[ -n "${KOVA_AZURE_OPENAI_RESOURCE_ID:-}" ]]; then
  AI_ID="$KOVA_AZURE_OPENAI_RESOURCE_ID"
else
  [[ -n "${KOVA_AZURE_OPENAI_ACCOUNT:-}" ]] || fail "KOVA_AZURE_OPENAI_ACCOUNT or KOVA_AZURE_OPENAI_RESOURCE_ID is required"
  AI_RG="${KOVA_AZURE_OPENAI_RESOURCE_GROUP:-$KOVA_AZURE_RESOURCE_GROUP}"
  AI_ID="$(az cognitiveservices account show -g "$AI_RG" -n "$KOVA_AZURE_OPENAI_ACCOUNT" --query id -o tsv)"
fi

collect() {
  az role assignment list --assignee-object-id "$PRINCIPAL" --scope "$1" --include-inherited --all -o json
}
ACR_ROLES="$(collect "$ACR_ID")"
KV_ROLES="$(collect "$KV_ID")"
AI_ROLES="$(collect "$AI_ID")"

node --input-type=module - "$ACR_ROLES" "$KV_ROLES" "$AI_ROLES" <<'NODE'
const [acrRaw, kvRaw, aiRaw] = process.argv.slice(2);
const checks = [
  [JSON.parse(acrRaw), 'AcrPull'],
  [JSON.parse(kvRaw), 'Key Vault Secrets User'],
  [JSON.parse(aiRaw), 'Cognitive Services OpenAI User'],
];
for (const [rows, role] of checks) {
  if (!rows.some((row) => row.roleDefinitionName === role)) throw new Error(`missing ${role}`);
  for (const row of rows) {
    if (['Owner', 'Contributor', 'User Access Administrator'].includes(row.roleDefinitionName)) {
      throw new Error(`production identity has excessive inherited role ${row.roleDefinitionName}`);
    }
  }
}
NODE

node --input-type=module - "$EVIDENCE" "$PRINCIPAL" "$ACR_ID" "$KV_ID" "$AI_ID" "$ACR_ROLES" "$KV_ROLES" "$AI_ROLES" <<'NODE'
import { writeFileSync } from 'node:fs';
const [path, principalId, acrId, keyVaultId, openAiId, acrRaw, kvRaw, aiRaw] = process.argv.slice(2);
const summarize = (raw) => JSON.parse(raw).map(({ roleDefinitionName, scope }) => ({ roleDefinitionName, scope }));
writeFileSync(path, `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  principalId,
  resources: { acrId, keyVaultId, openAiId },
  assignments: { acr: summarize(acrRaw), keyVault: summarize(kvRaw), azureOpenAi: summarize(aiRaw) },
  excessiveRolesPresent: false,
}, null, 2)}\n`);
NODE

echo "KOVA_AZURE_RBAC_VERIFICATION=PASS evidence=$EVIDENCE"
