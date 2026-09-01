# KovaGPT Azure production architecture

## Current production contract

KovaGPT is a TanStack Start application built with Vite and Nitro. Azure Container Apps is the single production application origin and deployment target. Azure Container Registry stores immutable application images, Key Vault or Container Apps secret references supply server credentials, and managed identity is used for Azure resource access.

Cloudflare is an edge-only layer in front of Azure Container Apps. Its allowed production responsibilities are proxied DNS, TLS, WAF/rate limiting, canonical redirects, and authenticated origin protection. Cloudflare Workers are not a KovaGPT application runtime or deployment target. The historical `.github/workflows/deploy-cloudflare-production.yml` file is intentionally validation-only and cannot deploy or shift traffic.

Supabase remains the identity authority and provides PostgreSQL and storage. Stripe remains the billing provider. Google and connector OAuth integrations remain independent provider integrations; they do not replace Supabase Auth.

This document defines the repository contract. It does not by itself prove that the live Azure revision, Cloudflare zone, DNS records, or origin protection match the contract.

## Production topology

The browser reaches the canonical hostname through Cloudflare. Cloudflare forwards approved traffic to the protected Azure Container Apps ingress. The Container App runs the generated Nitro Node server from `dist/server/index.mjs`, serves assets from `dist/client`, binds to the `PORT` supplied by Azure on `HOST=0.0.0.0`, and accesses server credentials through secret references.

The production resource set is:

- Azure Container Apps managed environment and production Container App.
- Azure Container Registry with digest-addressed images.
- User-assigned managed identity.
- Azure Key Vault for server-only secrets.
- Log Analytics and Application Insights.
- Azure OpenAI/Foundry deployments when production access and quotas are approved.
- Supabase Auth, PostgreSQL, and storage.
- Stripe billing and webhooks.
- Cloudflare edge configuration, managed separately by an authorized zone owner.

## Required environment variables

Browser-safe variables must use the `VITE_` prefix. Server-only secrets must never use `VITE_` and must come from Container Apps secrets or versioned Key Vault references.

Azure and application values include:

- `AZURE_ENVIRONMENT=production`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT_CHAT`
- `AZURE_OPENAI_DEPLOYMENT_THINKING`
- `AZURE_OPENAI_DEPLOYMENT_DEEP`
- `AZURE_OPENAI_DEPLOYMENT_IMAGE`
- `AZURE_OPENAI_DEPLOYMENT_EMBEDDING`
- `AZURE_CLIENT_ID`
- `PORT`
- `HOST`
- `AI_GENERATION_ENABLED`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS`

The browser and server Supabase configuration must resolve to the same approved production project. Supabase service-role, Stripe, OAuth, connector-encryption, and hashing secrets remain server-only.

## Identity and deployment

The Container App uses a user-assigned managed identity with only the required roles: ACR pull, Key Vault secret read, monitoring access where needed, and Azure OpenAI user access when generation is enabled. Avoid long-lived Azure credentials.

GitHub Actions authenticates to Azure with OIDC scoped to this repository and a protected deployment environment. A production deployment must:

1. Start from an exact green Git SHA and clean Git archive.
2. Validate the browser and server Supabase project identity.
3. Build and push to ACR with source SHA/tree/project provenance.
4. Capture and verify the pushed manifest's `sha256` digest.
5. Deploy `registry/repository@sha256:<digest>` to Azure Container Apps.
6. Confirm the Azure revision reports that exact image reference.
7. Verify `/api/livez`, `/api/readyz`, and `/api/version` on the revision-specific endpoint through an authorized origin-authenticated or internal probe, and then verify the same build identity on the canonical hostname.

A mutable image tag may be retained for discovery, but it is never deployment or rollback identity.

## Azure Container Apps boundary

Production ingress is HTTPS-only and uses `clientCertificateMode: require`. Cloudflare presents a custom per-hostname Authenticated Origin Pull certificate, Azure overwrites `X-Forwarded-Client-Cert` with the presented certificate, and the application compares its SHA-256 thumbprint against one or two configured fingerprints using a timing-safe comparison. A second fingerprint is permitted only for zero-downtime rotation. Raw Azure access without a client certificate must fail at the TLS boundary; a request that presents an unpinned certificate must receive a generic non-cacheable `403`. Verify both cases after every edge, certificate, or ingress change.

Container Apps startup, liveness, and readiness probes are TCP probes to the application port. This keeps platform probes independent of the public HTTP certificate boundary; authenticated HTTP health, readiness, and exact-build checks remain mandatory before traffic promotion.

Production revision mode and traffic changes must preserve a known-good rollback target. Scaling limits, probes, Log Analytics retention, Application Insights, and optional budget alerts are declared in `infra/azure/production/main.bicep`.

## Data, storage, billing, and email

Supabase remains the production authentication, PostgreSQL, and storage platform. Any future data or object-storage migration requires rehearsed checksums, owner-isolation validation, backups, and a separately approved cutover; it is not part of an application deployment.

Stripe remains the billing authority. Webhook secrets stay in Key Vault or Container Apps secrets, and webhook replay is permitted only after signature verification and durable idempotent persistence are confirmed.

Existing email behavior remains until a replacement provider is separately approved, authenticated, and tested for delivery, bounce, and complaint handling.

## Cloudflare edge operations

Source validation cannot mutate or attest the live Cloudflare zone. An authorized operator must inventory and back up the live zone, apply only approved edge/DNS changes, retain rollback values, and capture redacted proof of proxy state, TLS, WAF/rate limits, canonical redirects, cache behavior, `CF-Ray`, and unauthorized raw-origin denial.

The validation-only Cloudflare workflow must never receive deployment credentials, build the application, run Wrangler deployment, create routes or DNS records, or shift production traffic.

## Rollback strategy

Before each deployment, record the active Azure revision and immutable ACR digest. Rollback is revision/digest based:

1. Route traffic back to the last verified Azure revision when it remains available, or update the Container App to the recorded prior `repository@sha256:<digest>` image.
2. Verify the restored revision image reference, `/api/livez`, `/api/readyz`, and `/api/version` against the rollback SHA through an authorized origin-authenticated or internal probe.
3. Verify the canonical hostname serves that SHA through Cloudflare and still denies unauthorized raw-origin requests.
4. Record the incident, selected revision/digest, validation evidence, and any required forward-fix migration.

Do not roll back with a mutable tag, a branch name, a Cloudflare application deployment, or an unreviewed reverse database migration.

## Explicit constraints

- Do not deploy the KovaGPT application to Cloudflare.
- Do not treat a validation-only workflow run as live-zone or production proof.
- Do not delete or replace Supabase Auth/PostgreSQL/storage as part of an application release.
- Do not change production DNS or edge policy without an authorized owner, a backup, a rollback value, and post-change evidence.
- Do not claim production completion until the canonical hostname serves the exact approved SHA from the verified Azure digest and every required gate passes.
