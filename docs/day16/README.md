# Day 16 — final production release

Day 16 is the production-cutover and evidence phase. Source completion alone is not a production release.

## Final architecture

- **Cloudflare:** authoritative DNS, proxy/CDN, TLS edge, WAF/DDoS controls, and public-edge evidence only.
- **Microsoft Azure:** KovaGPT web runtime on Container Apps, scheduled/background execution through Container Apps Jobs, ACR, managed identity, Key Vault integration, Log Analytics, and Application Insights.
- **Supabase:** production auth, PostgreSQL, Storage, RLS, migrations, backups, and two-user isolation verification.
- **Azure OpenAI-compatible provider:** managed-identity access to the approved deployments. KovaGPT's highest logical model is `gpt-5.6-sol`.
- **Lovable:** no runtime, route, package, build, hosting, gateway, secret, email, webhook, or credit dependency.

## Release order

1. Reconcile the local migration directory by fetching remote history; never mark migrations applied or reverted blindly.
2. Create and verify a production Supabase backup; complete one restore rehearsal against a disposable database.
3. Run the complete local source gate.
4. Build and push the exact clean Git SHA to ACR, resolve its immutable digest, and review Azure `what-if`.
5. Deploy the digest to Azure and prove health/readiness, exact source identity, observability, and rollback evidence.
6. Route Cloudflare's proxied apex and `www` CNAMEs to the Azure origin and restrict Azure ingress to Cloudflare's current CIDRs.
7. Run authenticated production smoke tests for auth, AI streaming, tools/search, files/images/research, billing, tasks/jobs, and cross-user isolation.
8. Run the manual exact-SHA GitHub final release workflow once.
9. Close or preserve remaining PRs/branches only after comparing their unique patches with the exact release SHA.

## Truthful completion rule

KovaGPT is 100% complete only after the exact production SHA passes the production verifier, Cloudflare edge verifier, authenticated browser matrix, Supabase two-user test, billing/provider smoke tests, scheduler evidence, and rollback proof.
