# Azure staging deployment

This staging template creates a low-cost Azure Container Apps environment for a digest-pinned KovaGPT image. It does not deploy production and must be reviewed with `az deployment group what-if` before any resource mutation. Its default app name is `kovagpt-stg-web`; it is not an update path for the existing `ca-kovagpt-staging` app.

## Existing app: owned-auth preflight

For the existing `ca-kovagpt-staging` app in `rg-kovagpt-staging`, use the read-only validator `scripts/azure/owned-auth-staging-preflight.mjs`. It creates no infrastructure, resolves no secret, runs no workflow, and deploys nothing. It does not use or start `ca-kovagpt-auth-rehearsal`.

Copy `infra/azure/staging/owned-auth-preflight.example.json` to a private path outside the repository. The example deliberately fails until real observations and existing approval replace its placeholders. Set:

| Field                     | Required evidence                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscriptionId`          | Verified existing Azure subscription UUID.                                                                                                                                                                                                                                                                                                                                  |
| `sourceSha`, `sourceTree` | Exact reviewed 40-character commit and tree identifiers.                                                                                                                                                                                                                                                                                                                    |
| `imageReference`          | Existing immutable `registry.azurecr.io/repository@sha256:<64 hex>` reference.                                                                                                                                                                                                                                                                                              |
| `publicOrigin`            | Exact approved HTTPS staging origin, matching the app's ingress hostname or a configured custom domain.                                                                                                                                                                                                                                                                     |
| `app`                     | Private existing-app Azure snapshot, or a reviewed copy with only the proposed update applied. It must contain `id`, `name`, `type`, ingress, secret names and container image/environment. Keep the entire snapshot private; do not print environment values.                                                                                                              |
| `browserProvenance`       | Provenance extracted from that exact immutable image, with matching source/tree, bundle hash, verified source context, and `authMode: "kova"`. A runtime `VITE_KOVA_AUTH_MODE` value is not browser evidence.                                                                                                                                                               |
| `approval`                | Existing owner approval bound to the same target ID, source SHA and image: `environment: "staging"`, `deployAuthorized: true`, `attempts: 1`, ISO currency, nonnegative integer `maximumCostMinor` and `quotedMaximumCostMinor`, future ISO `stopAt`, and independently verified `stopSafeguardVerified: true`. A zero ceiling permits only a verified zero-cost operation. |

```bash
node scripts/azure/owned-auth-staging-preflight.mjs /private/path/owned-auth-preflight.json
```

The checker requires server `KOVA_AUTH_MODE=kova`, matching compiled browser mode, HTTPS origins, key fingerprints and signing-key ID, configured secret references for the private signing/encryption and service-role keys, enabled email queue, and disabled generation. Errors contain fixed codes only. A pass verifies configuration consistency and authorization bounds; it does not establish database schema, actual key usability/import, email-worker delivery, green exact-source CI, or successful deployed signup/reset/revocation. Verify those independently before activation. Review original approval, price evidence and automatic stop evidence; writing `true` into a packet does not create authority. A proposed-state snapshot also does not prove the configuration is deployed.

## Security model

- The image must be `repository@sha256:digest` and must already contain verified browser Supabase provenance.
- A user-assigned managed identity pulls from ACR.
- The same identity receives **Cognitive Services OpenAI User** on one existing Azure OpenAI account.
- The runtime reads `AZURE_OPENAI_ENDPOINT` from that exact account and selects the identity through `AZURE_CLIENT_ID`.
- No OpenAI or Azure OpenAI API key is accepted by the template.
- Key Vault is used only for the Supabase service-role key.
- Generation defaults off throu`h both `AI_GENERATION_ENABLED=false`and`KOVA_GENERATION_DISABLED=true`.
- The synthetic staging browser configuration must be compiled into the image; runtime `VITE_SUPABASE_*` values are prohibited.
- The environment uses single-revision mode, HTTPS-only ingress, bounded scale, health probes, Application Insights, and a Log Analytics daily cap.

## Required inputs

Use `infra/azure/staging/main.parameters.example.json` as a shape only. Replace every placeholder with approved staging resources. Never insert a real secret value into the parameter file.

Required existing resources:

1. Azure Container Registry containing the verified digest.
2. Key Vault containing a versioned `SUPABASE_SERVICE_ROLE_KEY`.
3. Azure OpenAI account containing reviewed deployments for chat, thinking, deep reasoning, image generation, and embeddings.
4. A synthetic staging Supabase project whose URL and publishable key match the immutable image provenance.

## Validation sequence

```bash
node scripts/azure/validate-staging-template.mjs
node --test tests/unit/azure-staging-template.test.mjs
az bicep build --file infra/azure/staging/main.bicep
az deployment group what-if   --resource-group <staging-resource-group>   --template-file infra/azure/staging/main.bicep   --parameters @infra/azure/staging/main.parameters.approved.json
```

Do not run `az deployment group create` until the Bicep build, `what-if`, database rehearsal, auth rehearsal, exact-image verification, and rollback plan all pass.

## Post-deployment evidence

Record the source SHA, image digest, Container App revision, revision-specific FQDN, browser provenance hash, Azure OpenAI resource ID, managed identity object/client IDs, Supabase project ref, and health/version responses. Enable generation only for an owner-approved smoke test, then close it again until final promotion.
