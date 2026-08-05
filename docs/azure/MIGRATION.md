# KovaGPT Azure Migration Plan

## Current architecture

KovaGPT is a TanStack Start application built with Vite and Nitro. Production currently remains on the existing Lovable/Cloudflare-oriented deployment path, with Supabase for auth/data, Stripe billing, Google OAuth, direct OpenAI, email integrations, and connector OAuth still active. Do not delete Lovable, Supabase, Stripe, Google OAuth, OpenAI, or existing DNS while this parallel Azure development deployment is validated.

## Target Azure architecture

The initial Azure target is a separate development deployment on Azure Container Apps running the generated Nitro Node server from `dist/server/index.mjs` and serving static assets from `dist/client`. Azure Container Apps supplies `PORT`; the app binds to `HOST=0.0.0.0`. Azure Container Registry stores images. Key Vault stores secrets. Managed identity is used for Azure resource access.

## Dependencies that remain temporarily

- Lovable production deployment and configuration.
- `kovagpt.com` DNS and existing production traffic path.
- Supabase auth, PostgreSQL, storage, and service-role operations.
- Stripe billing and webhooks.
- Google OAuth and connector OAuth providers.
- Direct OpenAI variables for rollback compatibility.

## Required Azure resources

- Resource group for development/staging.
- Azure Container Registry.
- Azure Container Apps environment and Container App.
- User-assigned managed identity.
- Azure Key Vault.
- Log Analytics workspace.
- Azure OpenAI / Foundry project and deployments when quota is approved.
- Future Azure Database for PostgreSQL Flexible Server.
- Future Blob Storage account.
- Future email provider or Azure Communication Services Email.

## Required environment variables

Public browser-safe variables must use `VITE_`. Server-only secrets must never use `VITE_` and must come from Container Apps secrets or Key Vault references.

Azure-ready non-secret values:

- `AZURE_ENVIRONMENT`
- `AZURE_FOUNDRY_ENDPOINT`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT_CHAT`
- `AZURE_OPENAI_DEPLOYMENT_THINKING`
- `AZURE_OPENAI_DEPLOYMENT_DEEP`
- `AZURE_CLIENT_ID`
- `PORT`
- `HOST`
- `AI_GENERATION_ENABLED`

Keep current OpenAI, Supabase, Stripe, Google OAuth, and connector variables until rollback is no longer needed.

## Managed identity plan

Create a user-assigned managed identity for the Container App. Grant only the minimum roles needed: Key Vault secret read access, ACR pull if not handled by registry credentials, and future Azure OpenAI access. Avoid long-lived client secrets.

## GitHub Actions workload identity federation plan

Configure GitHub Actions OIDC with Azure workload identity federation after the development deployment is ready. Scope federated credentials to this repository and deployment branches/environments. Do not create long-lived Azure credentials.

## Azure Container Registry plan

Build images in CI, push immutable tags to ACR after OIDC is configured, and deploy by digest or immutable tag. Enable vulnerability scanning if available in the selected Azure plan.

## Azure Container Apps plan

Deploy a separate development Container App with ingress enabled, target port `3000`, and health probes pointed at `/api/health`. Configure min/max replicas separately from production Lovable. Do not route production DNS to Azure until the cutover checklist is complete.

## Key Vault plan

Store Supabase service-role keys, Stripe keys, webhook secrets, OAuth secrets, OpenAI keys, connector encryption keys, and future Azure OpenAI credentials in Key Vault or Container Apps secrets. Never commit real values.

## Foundry / Azure OpenAI plan

Start with `AI_GENERATION_ENABLED=false` so the container can boot before Foundry or Azure OpenAI quota is approved. After quota approval, set Azure endpoints, API version, deployment names, and managed identity access. Keep direct OpenAI variables temporarily for rollback.

## PostgreSQL migration plan

Continue using Supabase PostgreSQL during development. Later, create Azure Database for PostgreSQL Flexible Server, rehearse schema/data migration, verify row-level security/auth semantics, run dual-read or staged validation where practical, and cut over only after backups and rollback are tested.

## Blob Storage migration plan

Continue Supabase Storage temporarily. Later, provision Blob Storage containers, migrate objects with checksums, update signed URL flows, and validate access controls before switching writes.

## Email migration plan

Keep existing email behavior initially. Evaluate Azure Communication Services Email or another provider, migrate templates and sender authentication, test bounce/complaint handling, and keep rollback to the current provider until production cutover is complete.

## Rollback strategy

For this phase, rollback is simply stopping the Azure development Container App; production remains on Lovable and `kovagpt.com` DNS is unchanged. For future cutovers, keep old infrastructure warm, preserve database backups, and use reversible configuration changes.

## Zero-downtime DNS cutover plan

Do not change DNS now. Later, validate Azure staging, lower DNS TTL, run parallel smoke tests, switch a canary hostname first, monitor logs/metrics, then update production DNS only after sign-off. Keep Lovable and Supabase intact until Azure production has been stable through the agreed observation window.

## Explicit warning

Do not delete Lovable or Supabase yet. Do not modify `kovagpt.com` DNS during this development-container phase.
