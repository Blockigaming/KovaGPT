# Guarded low-cost Azure staging deployment

This runbook prepares a synthetic KovaGPT staging environment on Azure Container Apps. It is intentionally separate from production and the Auth migration rehearsal.

It does not authorize deployment to `ca-kovagpt-dev`, real-user migration, production Supabase changes, or generation against live user data.

## Architecture

The template creates:

- one Azure Container Apps consumption environment;
- one public HTTPS-only staging web app;
- one user-assigned managed identity;
- `AcrPull` on an existing Azure Container Registry;
- `Key Vault Secrets User` on an existing staging Key Vault;
- Key Vault-backed references for `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`;
- one Log Analytics workspace with retention and daily ingestion controls;
- one workspace-based Application Insights resource;
- an optional resource-group monthly budget with 50%, 80%, and forecasted 100% notifications.

The staging web app defaults to:

- `minReplicas=0` so idle staging can scale to zero;
- `maxReplicas=2` to contain unexpected cost;
- 0.5 vCPU and 1 GiB memory per replica;
- single-revision mode;
- immutable `repository@sha256:digest` image input that was built and verified against the synthetic staging browser Supabase configuration;
- external HTTPS ingress on port 3000;
- generation disabled by both `AI_GENERATION_ENABLED=false` and `KOVA_GENERATION_DISABLED=true`;
- Luna for routine chat, Terra for deliberate reasoning, and Sol for explicit deep work after a separate generation-enable gate.

No Front Door resource is created for initial staging. The Container Apps FQDN is sufficient for synthetic verification and avoids an unnecessary fixed staging layer. Production edge/WAF configuration is a separate reviewed phase.

## Browser and server configuration must be identical

KovaGPT's browser client resolves `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` while Vite builds the image. Azure Container App runtime environment variables cannot rewrite those values inside an already-built JavaScript bundle.

The template therefore deliberately omits runtime `VITE_SUPABASE_*` variables. Until issue #164 lands a separately reviewed runtime-public-config implementation, the immutable staging image must already contain the synthetic browser configuration.

A deployment is invalid unless all of the following are proven for the exact image digest:

1. the browser bundle was compiled with the synthetic staging Supabase URL and publishable key;
2. the server runtime receives the same synthetic URL and publishable key through `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`;
3. the browser bundle contains neither the production project ref nor the Auth rehearsal project ref;
4. source SHA, image digest, and synthetic browser project ref are recorded together;
5. the image is not rebuilt, retagged, or replaced between verification and deployment.

Treat any browser/server project mismatch as a release-blocking authorization defect, not as a cosmetic configuration problem.

## Official Azure references

- Container Apps resource reference: https://learn.microsoft.com/azure/templates/microsoft.app/containerapps
- Container Apps scaling: https://learn.microsoft.com/azure/container-apps/scale-app
- Managed identities: https://learn.microsoft.com/azure/container-apps/managed-identity
- Key Vault secret references: https://learn.microsoft.com/azure/container-apps/manage-secrets
- Consumption budgets: https://learn.microsoft.com/azure/cost-management-billing/costs/quick-create-budget-bicep

## Files

```text
infra/azure/staging/main.bicep
infra/azure/staging/main.parameters.example.json
scripts/azure/validate-staging-template.mjs
tests/unit/azure-staging-template.test.mjs
```

Never place a real secret value in a parameters file. The template accepts only Key Vault secret URIs for server secrets. The Supabase publishable key is browser-safe but the example still uses a placeholder.

## Step 1: validate locally or in Cloud Shell

These commands are read-only with respect to Azure resources:

```bash
set -euo pipefail

node scripts/azure/validate-staging-template.mjs
node --test tests/unit/azure-staging-template.test.mjs
az bicep build --file infra/azure/staging/main.bicep --stdout >/dev/null
```

Expected local evidence includes:

```text
AZURE_STAGING_TEMPLATE_VALIDATION={"browserConfigIsBuildVerified":true,"containerAppApi":"2025-01-01","generationEnabled":false,"maxReplicas":2,"scaleToZero":true,"imageUsesDigest":true,"zeroLovable":true}
```

## Step 2: verify the Azure account

Read-only:

```bash
az account show \
  --query '{subscription:id,tenant:tenantId,user:user.name}' \
  --output json
```

Stop if the subscription or tenant is not the intended KovaGPT Azure account.

## Step 3: verify immutable image provenance

Before preparing Azure parameters, record the exact source and image identity:

```bash
set -euo pipefail

SOURCE_SHA="$(git rev-parse HEAD)"
IMAGE_REFERENCE="REPLACE_WITH_ACR_REPOSITORY@sha256:REPLACE_WITH_64_HEX_DIGEST"
SYNTHETIC_PROJECT_REF="REPLACE_WITH_SYNTHETIC_PROJECT_REF"

printf 'source_sha=%s\nimage_reference=%s\nbrowser_supabase_project_ref=%s\n' \
  "$SOURCE_SHA" \
  "$IMAGE_REFERENCE" \
  "$SYNTHETIC_PROJECT_REF"
```

The image build must have used the synthetic browser values explicitly. Do not infer this from Container App runtime variables.

Inspect the built client assets from the exact image or extracted Nitro artifact. The exact extraction command depends on the image layout, but the acceptance test is invariant:

```bash
set -euo pipefail

CLIENT_ASSET_ROOT="REPLACE_WITH_EXTRACTED_CLIENT_ASSET_DIRECTORY"
SYNTHETIC_PROJECT_REF="REPLACE_WITH_SYNTHETIC_PROJECT_REF"
PRODUCTION_PROJECT_REF="zrzwkqrwurgutrmvalri"
AUTH_REHEARSAL_PROJECT_REF="REPLACE_WITH_AUTH_REHEARSAL_PROJECT_REF"

rg --fixed-strings "$SYNTHETIC_PROJECT_REF" "$CLIENT_ASSET_ROOT" >/dev/null

if rg --fixed-strings "$PRODUCTION_PROJECT_REF" "$CLIENT_ASSET_ROOT"; then
  echo "SAFETY STOP: production Supabase ref is present in the staging browser bundle" >&2
  exit 1
fi

if rg --fixed-strings "$AUTH_REHEARSAL_PROJECT_REF" "$CLIENT_ASSET_ROOT"; then
  echo "SAFETY STOP: Auth rehearsal Supabase ref is present in the staging browser bundle" >&2
  exit 1
fi
```

Do not continue merely because the synthetic ref is present; the prohibited refs must also be absent.

## Step 4: prepare a temporary parameter file

Do not edit or commit the repository example with real values.

```bash
cp infra/azure/staging/main.parameters.example.json /tmp/kovagpt-staging.parameters.json
chmod 600 /tmp/kovagpt-staging.parameters.json
```

Edit only `/tmp/kovagpt-staging.parameters.json` and replace every `REPLACE_WITH_...` placeholder.

Required inputs:

- exact immutable ACR image reference in `repository@sha256:<64 hex>` form;
- build provenance proving that image's browser bundle was compiled with the same synthetic staging Supabase URL and publishable key supplied to the server runtime;
- existing ACR name and resource group;
- existing staging Key Vault name and resource group;
- Key Vault URI for the staging OpenAI key;
- Key Vault URI for the synthetic staging Supabase service-role key;
- synthetic staging Supabase URL and publishable key.

Do not use the real production Supabase project or the disposable Auth rehearsal project as general application staging.

Do not treat Container App runtime `VITE_SUPABASE_*` values as a browser configuration mechanism. Vite replaces those values during the image build. The template intentionally omits runtime `VITE_*` variables.

Keep:

```json
"generationEnabled": { "value": false }
```

until the staging app passes health, auth, authorization, storage, and redaction checks.

## Step 5: run Azure what-if only

`what-if` evaluates the change but does not deploy it:

```bash
set -euo pipefail

RG="rg-kovagpt-staging"

az deployment group what-if \
  --resource-group "$RG" \
  --name "kovagpt-staging-what-if" \
  --template-file infra/azure/staging/main.bicep \
  --parameters @/tmp/kovagpt-staging.parameters.json \
  --result-format FullResourcePayloads
```

Review every proposed resource. Stop if the output includes:

- `ca-kovagpt-dev`;
- the real production Supabase project;
- the Auth rehearsal project;
- a mutable image tag such as `latest`;
- a Lovable hostname, package, credential, or route dependency;
- generation enabled;
- a secret literal;
- runtime `VITE_SUPABASE_*` variables;
- more than two staging web replicas;
- an unexpected resource group, subscription, identity, registry, or Key Vault.

## Step 6: deploy only after explicit approval

The following commands mutate Azure. Do not run them as part of template review.

First create the staging resource group only if it does not already exist:

```bash
az group create \
  --name rg-kovagpt-staging \
  --location eastus \
  --tags application=kovagpt environment=staging managedBy=bicep
```

Then require an explicit local guard before deployment:

```bash
set -euo pipefail

: "${APPLY_KOVAGPT_STAGING:?Set APPLY_KOVAGPT_STAGING=YES only after approving the what-if output}"
[ "$APPLY_KOVAGPT_STAGING" = "YES" ] || {
  echo "SAFETY STOP: APPLY_KOVAGPT_STAGING must equal YES" >&2
  exit 1
}

az deployment group create \
  --resource-group rg-kovagpt-staging \
  --name "kovagpt-staging-$(date -u +%Y%m%dT%H%M%SZ)" \
  --template-file infra/azure/staging/main.bicep \
  --parameters @/tmp/kovagpt-staging.parameters.json
```

Unset the guard and remove the temporary file afterward:

```bash
unset APPLY_KOVAGPT_STAGING
rm -f /tmp/kovagpt-staging.parameters.json
```

## Step 7: post-deployment gates before generation

Keep generation disabled and verify:

1. the latest ready revision uses the exact immutable image digest;
2. HTTPS ingress works and HTTP is not accepted;
3. `/api/health` returns 200 without exposing configuration;
4. the app scales to zero and wakes successfully;
5. browser and server configuration prove the exact same synthetic Supabase project ref;
6. the service-role and OpenAI values remain Key Vault-backed secret references;
7. no Lovable environment variable, package, hostname, or outbound request exists;
8. two synthetic users cannot read or mutate each other's chats, files, projects, memory, tasks, or usage;
9. logs contain fixed operational fields but no prompt, message, token, file, OAuth credential, database URL, or raw provider error;
10. budget and Log Analytics controls are present.

Only after those gates pass should a separate revision set generation true for one tiny synthetic OpenAI smoke request. That change must be independently reviewed and immediately reconciled against usage and cost evidence.

## Not included yet

The initial staging template deliberately does not create:

- a background worker or scheduled Container Apps Job;
- Azure Front Door or WAF;
- Azure Blob migration;
- production DNS or certificates;
- a production budget amount;
- real-user data or Auth migration resources.

Those are separate workstreams because they have different cost, security, and rollback requirements.
