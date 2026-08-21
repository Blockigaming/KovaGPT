# Azure staging validation status

## Source-level status

- Template is isolated from the production Container App name.
- Immutable image digest is required.
- Browser Supabase configuration must be build-verified.
- Runtime `VITE_SUPABASE_*` overrides are prohibited.
- Azure OpenAI authentication is keyless through a user-assigned managed identity.
- Azure OpenAI RBAC is scoped to the existing Azure OpenAI resource.
- Supabase service-role access remains Key Vault-backed.
- HTTPS-only ingress, single-revision mode, health probes, scale-to-zero, bounded scale-out, Log Analytics capping, Application Insights, and optional budget controls are declared.
- Lovable package, hostname, credential, and runtime dependencies are prohibited by the validator.

## Still required before deployment

1. `az bicep build`.
2. Azure `what-if` in the approved staging resource group.
3. Exact ACR digest/provenance verification.
4. Synthetic Supabase schema and RLS rehearsal.
5. Current auth-migration rehearsal if migration code changed.
6. Azure OpenAI deployment existence and GPT-5.6 Sol route verification.
7. Revision-specific health, version, streaming, tools, files, images, search, billing-test, and scheduled-work smoke tests.
8. Rollback rehearsal.

No Azure resource mutation is implied by these files.
