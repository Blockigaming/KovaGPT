# KovaGPT release and rollback runbook

## Production contract

Azure Container Apps is the only production application origin and deployment target. Azure Container Registry stores the application image, and every deployment must use an immutable `repository@sha256:<digest>` reference. Cloudflare may sit in front of Azure only for owner-approved DNS proxying, TLS, WAF/rate limiting, canonical redirects, and authenticated origin protection. It does not host or deploy the KovaGPT application.

Supabase is the authentication, PostgreSQL, and storage provider. Stripe remains the billing provider. Do not add a second authentication authority.

Repository checks prove source contracts only. They do not prove the live Azure revision, Cloudflare zone, DNS, TLS, WAF, or origin-protection state. Production is validated only when the exact Git SHA is bound to an immutable image digest, the corresponding Azure revision passes health/readiness checks, and the canonical hostname serves that same SHA through the approved edge path.

## Pre-deployment

1. Use Node 24 and install exactly with `npm ci`.
2. Record the candidate SHA with `git rev-parse HEAD`. Require green CI for that exact SHA; do not substitute results from an ancestor, merge queue preview, or mutable branch name.
3. Confirm the protected Azure production environment, GitHub-to-Azure OIDC identity, ACR push permission, Container App name/resource group, and production Supabase project reference. Do not use long-lived Azure credentials.
4. Required server configuration includes `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, one of `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`, one of `KOVA_PUBLIC_URL`/`APP_URL`/`SITE_URL`, and `KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS`. The latter contains one approved per-hostname Authenticated Origin Pull client-certificate SHA-256 fingerprint, or two only during a zero-downtime certificate rotation. The browser Supabase URL/key and server Supabase URL must identify the same approved production project.
5. Before a hosted migration, set `SUPABASE_PROJECT_REF` to the exact 20-character production project reference. Non-interactive migration additionally requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in the protected environment.
6. Obtain a database backup, run `npm run release:manifest` and `npm run release:migrations`, and review `release-migrations.json`. Migrations are forward-only and applied lexically.
7. Run `npm run release:validate`, all required tests, and review `artifacts/release/bundle-report.json` before building the release image.

## Deployment

1. If the release contains approved migrations, apply them with `SUPABASE_PROJECT_REF=<exact-project-ref> npm run db:migrate`. The wrapper must link the exact project and refuse target-changing, seed, and work-directory flags. Stop if migration validation or application fails.
2. Build from an exact Git archive, not from a dirty workspace. Include the candidate SHA, Git tree, and approved browser Supabase project in the image provenance. Push the image to ACR and capture the manifest digest returned by the push.
3. Verify the pushed image labels and extracted provenance against the candidate SHA/tree/project. Resolve the pushed tag only as a consistency check; a mutable tag is never the deployment identity.
4. Confirm Cloudflare presents the approved per-hostname Authenticated Origin Pull certificate and that its SHA-256 fingerprint is present in the deployment parameters. Rehearse a first-time cutover on a non-production/canary hostname with Container Apps temporarily set to `accept`; promote only after the certificate is observed, with the prior ingress/DNS/revision values ready for rollback. Steady-state Azure ingress must use `clientCertificateMode: require`, and the application independently pins the forwarded certificate thumbprint. Add the new and old fingerprints together before a later rotation, switch Cloudflare, verify, and remove the old fingerprint in a subsequent deployment. A temporary `accept` state is never production-complete evidence.
5. Deploy Azure Container Apps with `ACR_LOGIN_SERVER/IMAGE_NAME@sha256:<digest>`. Confirm the created revision reports that exact digest-bound image.
6. Test the revision-specific Azure endpoint through an authorized origin-authenticated or internal probe before treating the release as healthy. Container Apps uses TCP startup/liveness/readiness probes so probe traffic cannot bypass application-layer certificate pinning. Require authenticated `GET /api/livez` to return `200` with `status=alive`, `GET /api/readyz` to return `200`, and `GET /api/version` plus `X-Kova-Build` to equal the candidate SHA. A `503`, unknown SHA, mismatched SHA, or tag-only image reference closes the gate.
7. Run `KOVA_EXPECTED_SHA=<candidate-sha> KOVA_SMOKE_BASE_URL=https://kovagpt.com npm run smoke:deployment`. Verify that this canonical Cloudflare path serves the same SHA and that an equivalent request sent directly to the raw Azure origin without the approved origin identity is denied.
8. Verify Supabase sign-in/callback, owner-scoped reads, Stripe webhook signature/delivery results, worker readiness, scheduled execution, and configured optional providers without paid test calls.

The manual `.github/workflows/deploy-cloudflare-production.yml` workflow is validation-only. The exact `VALIDATE` confirmation checks the repository's edge-only contract; it has no Cloudflare credentials, does not build or deploy the application, and cannot create DNS records or shift traffic. Live Cloudflare changes and evidence remain an authorized owner operation.

## Rollback and incidents

Before deployment, record the active Azure revision and its immutable ACR digest. Rollback means routing traffic to that previously verified revision or updating the Container App to that exact prior digest, followed by the same authorized health, readiness, SHA, canonical-host, and raw-origin-denial checks. Do not roll back with a mutable tag or merely redeploy a Git branch.

- Database changes are not rolled back blindly. Preserve user data and apply a reviewed forward-fix migration when a released migration cannot be safely reversed.
- An optional-provider incident should disable only the affected capability while retaining the application shell.
- For an agent failure, stop workers, preserve run/event rows, recover expired leases through the documented procedure, and resume only after readiness is green.
- For a Stripe webhook failure, retain provider events and correlation IDs, repair the idempotent handler, and replay only after persistence succeeds reliably.
- For a Supabase Auth outage, preserve signed-out access and fail authentication closed. Do not bypass authentication or introduce a second identity provider.
- For a database outage, remove the revision from ready traffic and do not accept writes.

## Post-deployment

Run the non-destructive smoke suite against both the revision-specific endpoint and canonical hostname. Inspect structured errors/correlation IDs, latency and error rate, Azure revision and digest identity, migration state, worker queue health, scheduled tasks, billing reconciliation, Supabase Auth callbacks, and optional-provider readiness. Annotate the release with the Git SHA, ACR digest, Azure revision, validation timestamps, and rollback revision/digest.

Paid provider or agent smoke remains a separate explicit operator action and is disabled by default.

## Schema, diagnostics, and staging rehearsal

- CI executes `npm run release:db:isolated` against a disposable local Supabase stack, dumps the schema, regenerates `database-contract.json`, and fails on drift. A machine without Docker may run `npm run release:db:dry`, but that is not equivalent database validation.
- The schema marker expected by `/api/readyz` is `20260803120000-v1`; a missing RPC, older marker, incomplete critical object set, timeout, or database failure keeps readiness closed.
- Detailed diagnostics stay disabled until `KOVA_ADMIN_USER_IDS` is configured server-side. Values are authenticated Supabase user IDs, never emails or browser claims. `GET /api/admin/diagnostics` is no-store and rate-limited.
- A staging rehearsal must use disposable staging identities/data and a non-production Azure revision. It is evidence for staging only and never authorizes production traffic shifting.
- Authenticated smoke records use the `__kova_smoke_` prefix, verify second-owner isolation, and delete created resources in `finally`. Production-like hostnames are refused unless `KOVA_ALLOW_PRODUCTION_SMOKE=1` is explicitly set by an authorized operator.
