# Azure staging and immutable-candidate preflight

The staging Bicep architecture is source-configured for:

- digest-only ACR images;
- a user-assigned managed identity;
- ACR pull permission;
- Key Vault access for the Supabase service-role secret only;
- resource-scoped Cognitive Services OpenAI User permission;
- Azure OpenAI endpoint and explicit chat/thinking/deep/image/embedding deployment names;
- GPT-5.6 Sol through the deep deployment mapping;
- synthetic build-verified Supabase browser configuration;
- generation disabled by default;
- HTTPS-only ingress, single-revision mode, health probes, scale-to-zero, bounded scale-out, Application Insights, Log Analytics capping, and optional cost budget.

Before any Azure mutation:

1. run `npm run azure:staging:validate`;
2. compile with `az bicep build`;
3. run an authenticated resource-group `what-if`;
4. verify the existing Azure OpenAI account and each deployment name;
5. verify managed-identity RBAC without printing tokens;
6. verify Key Vault secret references by metadata only;
7. build the exact final Git SHA from a clean archive;
8. record Buildx's pushed digest and ACR consistency check;
9. deploy to an inactive/staging revision;
10. validate revision-specific health and source SHA;
11. keep the prior healthy digest/revision for rollback.

No staging or production Azure resource is created or changed by these source files alone.
