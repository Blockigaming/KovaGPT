# Azure production deployment plan

## Current boundary

`.github/workflows/validate-azure-production.yml` is deliberately **plan-only**. A manual run on `main` uses the protected `production` environment and Azure OIDC to:

1. require an approved ACR `repository@sha256:digest` reference;
2. verify the image's exact Git commit, tree, production Supabase project, and browser provenance;
3. compile and validate `infra/azure/production/main.bicep`; and
4. show Azure's resource-group `what-if` result.

It has no deployment command, Container App update, DNS operation, Cloudflare credential, or traffic-shift step. Running the plan is not production deployment evidence.

The staging rehearsal is also non-deploying. An owner must deploy the staging digest through an independently reviewed Azure path first. The rehearsal then requires `/api/version` and `X-Kova-Build` to match the exact workflow SHA, requires root metadata emitted from the same immutable browser-config manifest used by the Supabase client to match the protected staging URL and publishable-key fingerprint, and traverses the deployed JavaScript dependency graph for the exact browser SHA before it performs edge, authenticated, or browser checks and before it emits candidate evidence. The public manifest deliberately uses only build-time browser values and public fallbacks; server-only Supabase variables remain isolated in the separate server client. Every smoke request has a bounded per-request timeout.

The current rehearsal has no authorized administrator-diagnostics step, so that gate is recorded as `not-run`, not `passed`. Its report therefore cannot satisfy the existing production guard until a real protected check is implemented, and the release-candidate manifest keeps `validation.staging` false. The staging report proves source/runtime checks only; it does not prove that the staging artifact is suitable for production, because browser-safe Supabase configuration is compiled for a specific environment.

## Protected environment contract

Before even the plan workflow may be run, configure the GitHub `production` environment with required reviewers, prevent self-review where supported, and restrict deployment branches to `main`. Configure the Azure federated credential for the environment-scoped GitHub OIDC subject; do not add a long-lived Azure client secret.

The environment must supply these non-secret variables:

- `KOVA_PRODUCTION_ACR_NAME`
- `KOVA_PRODUCTION_ACR_LOGIN_SERVER`
- `KOVA_PRODUCTION_IMAGE_REPOSITORY`
- `KOVA_PRODUCTION_RESOURCE_GROUP`
- `KOVA_PRODUCTION_SUPABASE_PROJECT_REF`

It must supply `KOVAGPTPROD_AZURE_CLIENT_ID`, `KOVAGPTPROD_AZURE_TENANT_ID`, `KOVAGPTPROD_AZURE_SUBSCRIPTION_ID`, and `KOVA_PRODUCTION_BICEP_PARAMETERS_JSON` as protected settings. The last value uses the shape in `infra/azure/production/main.parameters.example.json`; the workflow replaces `imageReference` with the reviewed digest and rejects placeholders or a mismatched ACR/Supabase target.

Grant the OIDC identity only the read and deployment-validation permissions needed for ACR pull, Bicep validation, and resource-group what-if. Do not grant a production apply role while this workflow is plan-only.

The protected plan accepts the `acr-git` source context emitted by the repository Dockerfile. Its `cancel-in-progress: false` policy prevents a running plan from being canceled. GitHub concurrency retains at most one running and one pending run per group and does not guarantee FIFO ordering, so this serializes eligible plans but is not a durable queue.

## Blockers before an apply workflow can exist

Do not add `az deployment group create`, `az containerapp update`, an automatic trigger, or a traffic-shift step until every item below has a reviewed resolution:

- `main.bicep` derives `${namePrefix}-web` instead of requiring the exact inventoried production Container App name. A mistaken prefix could create a second app rather than update the intended origin.
- The template replaces the complete Container App environment list but currently models only core Supabase and Azure AI settings. Stripe, payment webhooks, Google/connector OAuth, search, email, quota, and other enabled production settings need explicit Key Vault-backed representation or a proved preservation design.
- A production candidate needs a trusted, production-specific builder record. Staging images contain staging browser configuration and cannot be promoted; image labels and an embedded provenance file alone do not authenticate who built the image.
- ACR Pull, Key Vault Secrets User, and Azure OpenAI User role identifiers are declared but no production role assignments or fail-closed assignment preflight is encoded.
- `logRetentionDays` and `logDailyQuotaGb` are declared but unused, so the template does not enforce the cost controls their names imply.
- Single-revision mode sends 100% of traffic to the latest revision. The production design needs a documented previous-digest capture, exact-SHA verification through the Cloudflare edge, and a tested rollback or controlled revision strategy.
- Source now requires authenticated Cloudflare-to-origin requests and an approved client-certificate fingerprint. The live per-hostname certificate, Cloudflare Authenticated Origin Pull configuration, and denial of unauthorized raw-origin requests still need owner verification before the canonical hostname can rely on this origin.
- The live Azure inventory, GitHub environment protection, OIDC federation subject, least-privilege Azure roles, Key Vault secret versions, Cloudflare edge state, staging evidence, and rollback digest remain owner-verified inputs.

After those blockers are closed, add production apply behavior in a separate reviewed pull request. Preserve the manual `main` gate, protected `production` environment, OIDC, immutable digest, Bicep validation/what-if, exact runtime SHA check, and rollback evidence. Never turn the plan workflow itself into an automatic deploy path.
