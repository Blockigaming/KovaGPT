# Azure production deployment and rollback

## Runtime guarantees

`infra/azure/production/main.bicep` declares the production Container App, managed-identity RBAC, Key Vault references, Azure OpenAI deployment mapping, Cloudflare-only ingress rules, Log Analytics/Application Insights, and the scheduled Container Apps Job. The image parameter must be `repository@sha256:<digest>` and must carry the exact Git commit and tree.

## Preflight

- Work from a clean `main` branch.
- Verify `npm run release:day16:source` and the full local test suite.
- Set the Azure resource names, exact production Supabase project reference, browser-safe Supabase values, production parameter-file path, and Cloudflare verification values.
- Keep server credentials in Key Vault. The app identity must have ACR Pull, Key Vault Secrets User, and Cognitive Services OpenAI User only on the required resources.
- Keep `generationEnabled=false`, `bindCustomDomains=false`, and `deployScheduledJob=false` until their individual verification stages.

## Deployment

Run `npm run azure:production:deploy`. The script refuses a dirty repository, non-`main` branch, mutable image, mismatched Supabase project, or missing explicit confirmations. It runs local gates, builds the exact source, pushes ACR, resolves the digest, displays Azure `what-if`, deploys only after approval, waits for a healthy revision, verifies the live digest/SHA, and writes sanitized release evidence.

## Rollback

Deployment evidence records the previous immutable image and revision. Run:

```bash
npm run azure:production:rollback -- artifacts/release/<release>/azure-production-deployment.json
```

The rollback script requires an exact confirmation, restores the old immutable image, waits for health, and verifies the previous build identity when available. Database changes are never reversed automatically; use a reviewed forward-fix or a separately approved disaster-recovery procedure.
