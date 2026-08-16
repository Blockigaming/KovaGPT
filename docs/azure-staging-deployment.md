# Azure staging deployment

This staging template creates a low-cost Azure Container Apps environment for a digest-pinned KovaGPT image. It does not deploy production and must be reviewed with `az deployment group what-if` before any resource mutation.

## Security model

- The image must be `repository@sha256:digest` and must already contain verified browser Supabase provenance.
- A user-assigned managed identity pulls from ACR.
- The same identity receives **Cognitive Services OpenAI User** on one existing Azure OpenAI account.
- The runtime reads `AZURE_OPENAI_ENDPOINT` from that exact account and selects the identity through `AZURE_CLIENT_ID`.
- No OpenAI or Azure OpenAI API key is accepted by the template.
- Key Vault is used only for the Supabase service-role key.
- Generation defaults off throu`h both `AI_GENERATION_ENABLED=false` and `KOVA_GENERATION_DISABLED=true`.
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
