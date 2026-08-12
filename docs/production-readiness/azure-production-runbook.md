# Azure Container Apps staged cutover and rollback

This procedure is **not deployment authorization**. Use immutable image digests, retain the known-good revision, and keep application deployment separate from auth-data migration. Replace placeholders from read-only Azure output; never place secret values on a command line.

## Preconditions and read-only preflight

| Step           | Class     | Command                                                                                                                                                        | Expected result / stop condition                                                                                                |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | READ ONLY | `az account show --query '{subscription:id,tenant:tenantId,user:user.name}' -o json`                                                                           | Approved tenant/subscription; **STOP** on mismatch.                                                                             |
| App            | READ ONLY | `az containerapp show -g <RG> -n <APP> -o json > /tmp/kova-app.json`                                                                                           | Existing intended app; **STOP** if absent. Historical `rg-kovagpt-dev` and `ca-kovagpt-auth-rehearsal` are not assumed current. |
| Revisions      | READ ONLY | `az containerapp revision list -g <RG> -n <APP> -o json > /tmp/kova-revisions.json`                                                                            | Record active known-good revision and traffic. **STOP** if no rollback target.                                                  |
| Registry/image | READ ONLY | `az acr repository show-manifests -n <ACR> --repository <IMAGE> --query "[?digest=='<SHA256_DIGEST>']" -o json`                                                | Exactly one immutable digest; **STOP** on tag-only or provenance mismatch.                                                      |
| Contract       | READ ONLY | `node scripts/staging-validation/azure-preflight.mjs --metadata /tmp/kova-app.json`                                                                            | PASS; output contains no secret values.                                                                                         |
| Environment    | READ ONLY | export only environment-variable **names** from the app metadata, then `node scripts/staging-validation/environment-diff.mjs --input /tmp/kova-env-names.json` | No BLOCKER.                                                                                                                     |

## Zero-traffic candidate

1. **DEPLOYS REVISION:** create a named candidate from `<IMAGE>@sha256:<DIGEST>` using the approved Container Apps deployment workflow or `az containerapp update -g <RG> -n <APP> --image <IMAGE>@sha256:<DIGEST> --revision-suffix <SHORT_SHA>`. Do not change secret values; use existing/versioned secret references.
2. **CHANGES TRAFFIC:** immediately force the candidate to zero: `az containerapp ingress traffic set -g <RG> -n <APP> --revision-weight <KNOWN_GOOD>=100 <CANDIDATE>=0`.
3. **READ ONLY:** wait for the candidate revision to report healthy replicas. **STOP** on restart loops, probe failures, or unexpected bindings.
4. **READ ONLY:** query the candidate revision FQDN `/api/health`, `/`, and a reviewed no-AI public route. Expect HTTPS, `Cache-Control: no-store` on health, and no secret/internal URL disclosure.
5. Run `npm run staging:validate -- --environment /tmp/kova-env-names.json --azure /tmp/kova-app.json --callbacks /tmp/kova-callbacks.json`.
6. Execute two-user Supabase, auth, Stripe test-mode, bounded provider, and OAuth test-app checks. Credential-gated checks must not be called passed until executed.

## Progressive traffic (explicit change approval required at every step)

Use `az containerapp ingress traffic set -g <RG> -n <APP> --revision-weight <KNOWN_GOOD>=<OLD> <CANDIDATE>=<NEW>` for `1%`, `10%`, `50%`, and finally `100%`. At each stage observe an approved window for 5xx, latency, auth, provider failure categories, Stripe webhook outcomes, rate limits, replica restarts, and correlation IDs. **STOP and rollback** on an isolation, billing, callback, residency, data-integrity, or SLO discrepancy. Retain the prior revision after 100% cutover.

## Rollback

Preview the exact command:

```bash
node scripts/staging-validation/azure-rollback.mjs \
  --metadata /tmp/kova-revisions.json \
  --resource-group <RG> --app <APP> \
  --known-good <KNOWN_GOOD> --candidate <CANDIDATE>
```

After authorized review, execute the emitted `az containerapp ingress traffic set` command, then verify known-good `/api/health`, auth, a no-write route, and error rate. Set the bad candidate to zero traffic; do **not** delete revisions, secrets, databases, migrations, or user data. App rollback does not reverse a database/auth migration; that requires a separately approved forward-fix/restore plan.
