# KovaGPT manual production handoff

This file is for the separate **KovaGPT Manual** conversation. It contains only actions that
require an authenticated production control plane, protected approval, an authorized account
owner, a real browser/account, or a legal, tax, financial, or customer-policy decision. It is not
a substitute for unfinished engineering work.

## Current disposition

**Do not execute a production cutover or enable live billing yet.** As of 2026-09-02, repository
`Blockigaming/kovagpt-790c8a3a` had `main` at
`f95793e179aefe7006b3a5a1cbbeb9b9c7365ece`. GitHub returned no workflow runs associated with that
exact merge SHA, so a green exact-main release/browser matrix was not proven; the 2026-09-01 public
observation also did not identify production as that SHA. Several source and infrastructure
remediations remained release prerequisites. Every action below is therefore either `BLOCKED` or
`OWNER_REQUIRED`; none is a completed release gate.

Never put passwords, API tokens, Stripe signing secrets, OAuth client secrets, private keys,
customer data, browser storage, authorization codes, or unredacted provider exports in Git,
issues, pull requests, screenshots, HAR files, shell history, or chat. A SHA-256 certificate
thumbprint, provider object ID, image digest, revision name, and redacted configuration are safe
release identifiers, not credentials.

**Cost boundary for every item:** the authorized incremental spend is `$0`. Use only already
approved, included capacity. Do not add replicas, paid Cloudflare features, log ingestion or
retention, a second Container App, a new monitoring workspace, a paid provider, or any other
billable capacity. If an authenticated `what-if` or provider checkout shows any incremental cost,
stop; record the cost/owner decision as unresolved rather than approving or purchasing it.

## Evidence baseline to re-read before acting

The observations below are dated leads, not permanent truth. Re-read each provider immediately
before a write.

| Area              | Dated evidence                                                                                                                                                                                                                                                                                                                                 | Release consequence                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GitHub            | 2026-09-02: `main` was `f95793e179aefe7006b3a5a1cbbeb9b9c7365ece`; GitHub returned no workflow runs associated with that exact merge SHA. A green exact-main release/browser matrix was therefore not established.                                                                                                                             | No production deployment or protected approval may use this baseline as a release candidate. |
| Public production | 2026-09-01: `https://kovagpt.com/api/version` reported an unknown SHA/version; the public deployment was not proven to match reviewed `main`.                                                                                                                                                                                                  | Exact-SHA production proof is absent.                                                        |
| Cloudflare/DNS    | 2026-09-01: Cloudflare nameservers were authoritative, but apex and `www` appeared DNS-only; no `CF-Ray` was observed and the raw Azure Container Apps hostname was usable.                                                                                                                                                                    | Cloudflare proxying and origin authentication are mandatory before release.                  |
| Azure             | 2026-09-01: this execution had no authenticated Azure session. The positively identified production tenant, subscription, resource group, app, Key Vault, ACR, staging app, and rollback revision remain unresolved.                                                                                                                           | Do not infer resource names or touch `ca-kovagpt-dev`.                                       |
| Stripe            | 2026-09-01: live account `acct_1UAeDgAEZlsb6DBY` contained active Plus price `price_1UAzhHAEZlsb6DBYWw2oUCeO` (`plus_monthly`, USD 16/month) and Pro price `price_1UAzhRAEZlsb6DBYlafU4mhc` (`pro_monthly`, USD 89/month). No live webhook endpoint or default Portal configuration existed. Stripe Tax was active but had zero registrations. | Do not duplicate prices. Keep automatic tax and customer charging disabled.                  |
| Supabase/Auth     | 2026-09-01: production project `mfbycmbjygcfkrsuepxf` reported Google enabled, but no successful production OAuth round trip was captured.                                                                                                                                                                                                     | Provider configuration is not end-to-end proof.                                              |

## Non-negotiable entry gate

Before any item marked `BLOCKED` is attempted, the release operator must record all of the
following in one release record:

1. The 40-character reviewed `main` SHA and a link to the exact commit.
2. Green required GitHub checks for that exact SHA, including repository validation, isolated
   database, release/browser, Azure/container readiness, security, accessibility, and review.
3. No unresolved P0, P1, or P2 release blocker or unresolved required review thread.
4. An immutable ACR image reference of the form `repository@sha256:<64 hex>` built from that SHA.
5. A green staging deployment of that same digest, including authenticated owner-isolation and
   rollback rehearsal evidence. The current `.github/workflows/staging-rehearsal.yml` is
   deployment-capable: an approved dispatch invokes bare `npx wrangler deploy`, but no `--env` or
   Wrangler staging environment proves which Cloudflare account and Worker it will write. It is
   neither validation-only nor Azure same-digest staging proof; do not dispatch it until an
   authorized owner verifies the exact Cloudflare account/Worker target and approves that write.
6. A reviewed Supabase production migration/backup record and green readiness.
7. Billing source remediations merged and proven in sandbox; no live customer or payment object is
   needed to satisfy this entry gate.
8. A redacted backup of the current Azure, Cloudflare, Stripe, Supabase Auth, and Google OAuth
   configuration and an explicit rollback target for every planned write.
9. A reviewed two-phase origin-cutover mechanism. The first phase must let the current DNS-only
   service remain healthy while Azure accepts/audits the expected Cloudflare client certificate;
   the second phase may enforce `clientCertificateMode: require` and the exact certificate hash
   only after proxied DNS/AOP has been proven for at least the prior DNS TTL. A one-phase
   require-and-proxy sequence is an engineering blocker, not a manual workaround.
10. PR #227 is merged and the former compatibility routes are absent from current source. Before
    declaring production zero-Lovable, complete a read-only control-plane and log inventory for
    the retired compatibility URLs: Supabase Auth authorization and redirect configuration, Azure
    and Cloudflare routing/access logs, provider webhook/email configuration and logs, and known
    external clients. Migrate any legitimate external caller to Kova-owned routes through a
    separately reviewed change, attach redacted evidence to issue #208, and keep that issue open
    through post-deploy exact-SHA route/asset/network/log proof. Repository-only search is
    insufficient production evidence.

From an exact detached checkout, the repository-side check begins with:

```bash
export KOVA_RELEASE_SHA='<reviewed 40-character main SHA>'
git fetch --force origin main
git checkout --detach "$KOVA_RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$KOVA_RELEASE_SHA"
npm ci --ignore-scripts --no-audit --no-fund
npm run release:validate
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:api
```

Local success supplements, but never replaces, the required hosted check suite on the same SHA.

## Manual items

### MAN-01 — Authenticate and inventory the production control planes

- **Status:** `OWNER_REQUIRED`
- **Kind:** authentication, permission
- **Service/account/project:** Microsoft Azure account that owns KovaGPT production; Cloudflare
  account containing zone `kovagpt.com`; GitHub repository
  `Blockigaming/kovagpt-790c8a3a` protected `staging` and `production` environments
- **Owner:** authorized KovaGPT cloud/account owner or a production operator delegated least
  privilege by that owner
- **Prerequisites:** none; this is read-only inventory. MFA, passkey, CAPTCHA, account picker, and
  protected-environment approval must be completed by the human owner.
- **Why manual:** this execution has no authenticated Azure or Cloudflare control-plane session and
  cannot choose an account, satisfy MFA, or accept production authority.

**Exact owner action**

1. Sign in without sharing credentials. Select the Cloudflare account that already contains
   `kovagpt.com`. In Azure, positively identify the tenant and subscription from billing/resource
   ownership; do not choose by a similar display name.
2. Record the Azure tenant ID, subscription ID, production and staging resource groups, Container
   Apps environment/app names, ACR, Key Vault, managed identities, Log Analytics workspace,
   Application Insights resource, current image digest, active revision, traffic weights, custom
   domains, probes, every runtime environment-variable name/value source, and every
   secret-reference **name only**. Redact secret values, but do not omit variables: a partial IaC
   template can otherwise replace the full production runtime contract.
3. Record the Cloudflare account ID, zone ID, DNS record IDs/values/proxy flags/TTLs, SSL mode,
   edge certificate state, origin certificate/AOP state, DNSSEC, CAA, redirect rules, WAF/rate
   rules, cache rules, Workers/routes, and audit-log pointer. Redact tokens and private keys.
4. In GitHub, confirm required reviewers and branch restrictions for the `staging` and `production`
   environments. Do not weaken protection to make a run pass.

Read-only Azure discovery can use:

```bash
az login
az account list --output table
az account show --query '{tenantId:tenantId,subscriptionId:id,name:name}' --output json
az group list --query '[].{name:name,location:location}' --output table
az containerapp list --query '[].{name:name,resourceGroup:resourceGroup,fqdn:properties.configuration.ingress.fqdn}' --output table
```

After the owner has selected the exact production resources, capture redacted state with explicit
names:

```bash
export AZURE_PROD_RG='<positively identified production resource group>'
export AZURE_PROD_APP='<positively identified production Container App>'
az containerapp show --resource-group "$AZURE_PROD_RG" --name "$AZURE_PROD_APP" \
  --query '{id:id,mode:properties.configuration.activeRevisionsMode,fqdn:properties.configuration.ingress.fqdn,image:properties.template.containers[0].image,latestRevision:properties.latestRevisionName}' \
  --output json
az containerapp revision list --resource-group "$AZURE_PROD_RG" --name "$AZURE_PROD_APP" \
  --query '[].{name:name,active:properties.active,created:properties.createdTime,traffic:properties.trafficWeight,image:properties.template.containers[0].image}' \
  --output json
```

**Risk:** selecting the wrong subscription/account can expose or mutate unrelated resources.
**Consequence of not performing:** no Azure, Cloudflare, DNS, or protected deployment write is
authorized. **Evidence already collected:** public DNS/TLS/HTTP behavior and repository IaC were
inspected, but no authenticated Azure or Cloudflare inventory was available. **Automated work
already complete:** public protocol inspection and source/IaC review. **Rollback:** none for
read-only inventory; sign out/revoke the temporary session if the wrong account was selected.
**Exact proof required:** redacted inventory with provider IDs, UTC timestamp, operator
identity/role, and links to the provider audit-log views.

### MAN-02 — Stage one immutable digest and deploy the non-enforcing production phase

- **Status:** `BLOCKED`
- **Kind:** permission, protected approval, provider action
- **Service/account/project:** the exact Azure production resources resolved in MAN-01 and GitHub
  repository `Blockigaming/kovagpt-790c8a3a`
- **Owner:** authorized Azure/GitHub production operator; a separate required reviewer approves the
  protected environment where policy requires it
- **Prerequisites:** the non-negotiable entry gate; reviewed two-phase origin-cutover IaC on exact
  `main`; an ACR digest built from `KOVA_RELEASE_SHA`; a known-good previous production
  digest/revision; staging and production must use isolated configuration. Phase one must use an
  Azure client-certificate **accept/audit** posture that keeps existing DNS-only clients healthy;
  it must not require a certificate yet.
- **Why manual:** production resource identity and Azure authentication are unavailable here, and
  the protected environment can require a human approval.

The baseline has additional engineering blockers that no owner should work around in the portal:
there is no production Azure deploy workflow; the staging rehearsal still deploys with Wrangler;
the production Bicep derives an app target instead of binding the positively identified existing
resource, would replace the runtime environment with an incomplete set, omits required role
assignments, and declares log retention/quota parameters without applying them. Engineering must
correct and review those contracts first. Do not hand-edit a live app to compensate.

**Exact owner action**

1. Confirm the image is addressed by digest, not `latest` or another mutable tag. Record the ACR
   repository, digest, source SHA, build run, SBOM/provenance pointer, and scan result.
2. Deploy that digest to the positively identified **staging** app. Run health, readiness,
   authenticated isolation, streaming/upload, OAuth, billing-sandbox, and rollback checks there.
3. Capture the current production image and revision as the rollback target. Run an Azure Bicep
   `what-if` against the exact production resource group. Review every change, especially ingress,
   identity/RBAC, the complete runtime environment, Key Vault references, replicas, effective log
   retention/quota, and client-certificate mode. Confirm the computed Container App resource ID is
   exactly the existing `AZURE_PROD_APP`; a similarly named second app is a stop condition. Any
   omitted existing runtime variable/secret reference or full-array replacement is also a stop
   condition.
4. Confirm `what-if` creates no resource, replica, premium feature, workspace, retention, or log
   capacity and has `$0` incremental cost. After protected approval, deploy the same digest to
   production in the reviewed **non-enforcing accept/audit phase**. Do not deploy the final
   client-certificate requirement yet. Do not deploy or alter `ca-kovagpt-dev`.
5. Record the Azure deployment operation ID, new revision, image digest, managed-identity and Key
   Vault access result, probe status, client-certificate phase, and UTC start/end times. Continue
   immediately to MAN-03; phase one is not a completed production release.

Use a secure, untracked parameter file derived from the reviewed example. It must contain only
provider IDs and Key Vault secret URIs, never secret values. Replace every placeholder before use:

```bash
export KOVA_PROD_PARAMS='<absolute path to secure untracked production parameters file>'
az deployment group what-if \
  --resource-group "$AZURE_PROD_RG" \
  --template-file infra/azure/production/main.bicep \
  --parameters "@$KOVA_PROD_PARAMS"
az deployment group create \
  --name "kovagpt-$KOVA_RELEASE_SHA" \
  --resource-group "$AZURE_PROD_RG" \
  --template-file infra/azure/production/main.bicep \
  --parameters "@$KOVA_PROD_PARAMS" \
  --mode Incremental
```

Do not run the `create` command unless `what-if` targets the recorded existing resource IDs,
matches the reviewed change set, has no unrelated deletion, and has `$0` incremental spend. The
currently reviewed IaC is not safe to apply if it unconditionally sets
`clientCertificateMode: require` while public DNS remains DNS-only. A phase-one deployment is not
proof of final promotion; verify:

```bash
az containerapp show --resource-group "$AZURE_PROD_RG" --name "$AZURE_PROD_APP" \
  --query '{fqdn:properties.configuration.ingress.fqdn,revision:properties.latestReadyRevisionName,image:properties.template.containers[0].image,running:properties.runningStatus}' \
  --output json
curl --fail --silent --show-error "https://kovagpt.com/api/health"
curl --fail --silent --show-error "https://kovagpt.com/api/livez"
curl --fail --silent --show-error "https://kovagpt.com/api/readyz"
curl --fail --silent --show-error "https://kovagpt.com/api/version" | jq .
```

**Risk:** a wrong digest, secret reference, probe, resource name, certificate phase, or traffic
switch can cause outage, duplicate spend, or data-path failure. Enforcing a client certificate
before proxied DNS has aged past its previous TTL will deny current and cached DNS-only clients.
**Consequence of not performing:** production remains an unverified old/unknown build.
**Evidence already collected:** production currently reports no exact SHA; the staging workflow is
Cloudflare/Wrangler-based, no production Azure deploy workflow exists, and the Bicep target/runtime
environment/RBAC/logging contracts are not deployment-safe. **Automated work already complete:**
source validation tooling, health/version routes, and partial container/IaC contracts exist, but
the exact release matrix and non-mutating Azure plan are not yet green.

**Rollback:** do not delete the previous image/revision. If approved IaC remains in single-revision
mode, redeploy the prior immutable digest through the same reviewed Bicep path. If approved IaC
uses multiple revisions, move 100% traffic back to the recorded healthy revision:

```bash
export AZURE_PREVIOUS_REVISION='<recorded healthy production revision>'
az containerapp ingress traffic set --resource-group "$AZURE_PROD_RG" --name "$AZURE_PROD_APP" \
  --revision-weight "$AZURE_PREVIOUS_REVISION=100"
```

Re-run health and exact-version checks after rollback. **Exact proof required:** green staging run,
the same staging/production digest, exact existing resource IDs, `$0` incremental spend,
production revision and traffic record, exact `/api/version` SHA and `X-Kova-Build`, green
`/api/livez` and `/api/readyz`, managed-identity access, phase-one accept/audit state, zero secret
exposure, and a timestamped rollback rehearsal against staging.

### MAN-03 — Proxy DNS through Cloudflare and enforce authenticated origin access

- **Status:** `BLOCKED`
- **Kind:** permission, provider action, TLS/DNS change
- **Service/account/project:** Cloudflare zone `kovagpt.com`; exact Azure Container App from MAN-01
- **Owner:** authorized Cloudflare and Azure production operator
- **Prerequisites:** MAN-01 and MAN-02 phase one; a healthy exact-digest Azure revision; reviewed
  source/IaC with separate accept/audit and enforce phases; final enforcement must set Container
  Apps `clientCertificateMode: require` **and** validate the allowlisted Cloudflare leaf certificate
  SHA-256 hash from `X-Forwarded-Client-Cert`; working TCP/internal Azure probes; a redacted DNS,
  TLS, rule, and origin backup; a tested rollback path
- **Why manual:** Cloudflare/Azure authentication and DNS authority are unavailable here. A custom
  AOP private key must remain in owner-controlled custody.

`clientCertificateMode: require` alone is insufficient: Azure Container Apps accepts CA-issued or
self-signed client certificates. Kova must validate the exact Cloudflare certificate hash/chain.
Do not enforce origin mTLS until the application validation and probe behavior are green in
staging and production has remained healthy through Cloudflare for at least the DNS TTL recorded
before proxying.

**Exact owner action**

1. Bind valid Azure origin TLS/custom-domain certificates before setting Cloudflare to **Full
   (strict)**. Confirm certificate hostname coverage and renewal. Do not hard-code the observed
   Azure IP.
2. Following Cloudflare's per-hostname AOP procedure, create an owner-controlled CA and leaf client
   certificate or use the owner's approved PKI. Upload the **leaf** certificate and private key to
   Cloudflare, record its Cloudflare certificate ID/expiry, and associate it separately with
   `kovagpt.com` and `www.kovagpt.com`. Never commit either private key.
3. Obtain the leaf SHA-256 thumbprint and place only that non-secret 64-hex value in the reviewed
   production configuration expected by Kova. In the MAN-02 phase-one accept/audit posture, prove
   Azure/Kova observes that exact hash from requests through each Cloudflare hostname without
   rejecting the still-DNS-only population. A second fingerprint slot may be populated only for a
   documented certificate rotation.
4. Proxy the apex and `www` web records (orange cloud) to the approved Azure target. Use a hostname
   target/CNAME flattening or reviewed origin rule—not the last observed IP. Configure `www` to the
   canonical apex with path and query preservation.
5. Set SSL/TLS to **Full (strict)**, minimum TLS 1.2, and TLS 1.3 where included. Exclude `/api/*`,
   auth/session, OAuth callbacks, Stripe webhooks, personalized HTML, signed URLs, uploads, SSE,
   and WebSockets from cache, redirects, and body transformations. Do **not** broadly bypass the
   managed WAF. Use narrowly scoped no-interactive-challenge rules only where protocol semantics
   require them (notably OAuth callbacks and the Stripe webhook), while retaining compatible
   managed inspection and tested rate controls.
6. Wait at least the full pre-change DNS TTL after the proxy change. From independent resolvers and
   networks, prove both hostnames return `CF-Ray`, Cloudflare presents the expected leaf cert to
   Azure, health/readiness and OAuth/webhook/stream/upload paths work, and no client still depends
   on a DNS-only route.
7. Only then deploy the final configuration—using the **same image digest**—that sets
   `clientCertificateMode: require` and rejects a missing, malformed, duplicate, or unallowlisted
   certificate hash. Re-run every edge/origin test. Preserve the previous DNS values, rule IDs,
   certificate association, phase-one Azure revision, and prior image through the rollback window.

Certificate and DNS checks:

```bash
openssl x509 -in '<Cloudflare AOP leaf certificate path>' -noout -fingerprint -sha256 -dates -subject
dig +short kovagpt.com A
dig +short kovagpt.com AAAA
dig +short www.kovagpt.com CNAME
curl --silent --show-error --dump-header - --output /dev/null https://kovagpt.com/
curl --silent --show-error --dump-header - --output /dev/null https://www.kovagpt.com/
curl --silent --show-error --dump-header - --output /dev/null \
  'https://kovagpt.com/api/version'
```

The public responses must include Cloudflare evidence such as `CF-Ray`; `/api/version` must be
`no-store`; the `www` redirect must preserve an innocuous test path and query. Test the raw Azure
FQDN without a client certificate and with a deliberately unrelated client certificate; both must
fail closed before reaching application content:

```bash
export AZURE_ORIGIN_FQDN='<exact Container Apps origin FQDN>'
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "https://$AZURE_ORIGIN_FQDN/"
export UNRELATED_CLIENT_CERT='<path to a disposable unrelated client certificate>'
export UNRELATED_CLIENT_KEY='<path to its private key>'
curl --silent --show-error --cert "$UNRELATED_CLIENT_CERT" --key "$UNRELATED_CLIENT_KEY" \
  --output /dev/null --write-out '%{http_code}\n' "https://$AZURE_ORIGIN_FQDN/"
```

Expected proof is TLS rejection or a generic non-sensitive 403/421, never KovaGPT HTML/API data.
Also prove that an invalid-signature POST reaches the application webhook route through
Cloudflare without redirect, challenge, cache, or 5xx:

```bash
curl --silent --show-error --dump-header - --output /dev/null --request POST \
  'https://kovagpt.com/api/public/payments/webhook?env=live' \
  --header 'Content-Type: application/json' --data '{}'
```

An application-generated 400 is expected because no `Stripe-Signature` is supplied. This is not a
signed webhook pass.

**Risk:** DNS, origin TLS, AOP, redirect, WAF, or cache errors can cause a full outage, leak an
origin bypass, corrupt webhook signatures, or break OAuth/streaming. **Consequence of not
performing:** Cloudflare and raw-origin release gates remain failed. **Evidence already collected:**
the zone appeared DNS-only and the raw origin was reachable. **Automated work already complete:**
public protocol inspection and origin-boundary source/IaC work were prepared for review.

**Rollback:** if final enforcement fails, first restore the recorded phase-one accept/audit Azure
revision while keeping Cloudflare proxy/AOP in place; verify health. If the proxy/AOP layer itself
fails, restore the known-good certificate association or Cloudflare rules, then use the recorded
DNS values only after the origin is again safe for DNS-only traffic. Do not delete the prior
certificate/private key or remove origin authentication piecemeal during the rollback window.
**Exact proof required:** zone/record IDs and proxy flags, prior TTL and elapsed wait, Full (strict),
certificate IDs/expiry/thumbprint, expected hash observed in phase one, `CF-Ray` at apex and `www`,
path/query-preserving canonical redirect, no cache/transform/interactive challenge on protected
protocol paths without a blanket WAF bypass, correct streaming/upload behavior, missing and wrong
client-cert denial at the raw origin, and provider audit-log entries.

Official references:

- [Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/)
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [Cloudflare per-hostname Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/per-hostname/)
- [Azure Container Apps client certificate authorization](https://learn.microsoft.com/en-us/azure/container-apps/client-certificate-authorization)

### MAN-04 — Decide DNSSEC, HSTS preload, and certificate-authority scope

- **Status:** `OWNER_REQUIRED`
- **Kind:** provider decision, permission, potentially irreversible browser/registrar action
- **Service/account/project:** Cloudflare zone `kovagpt.com`; the exact registrar account that
  holds `kovagpt.com` delegation, which MAN-01 must resolve and record because it was unknown at
  this baseline
- **Owner:** domain registrant/account owner, with production operator review
- **Prerequisites:** MAN-03 green; all intended subdomains HTTPS-capable; complete certificate
  issuer/renewal inventory
- **Why manual:** registrar DS publication and HSTS preload submission require domain-owner
  authority and can cause long-lived outages if wrong.

**Exact owner action:** review the existing `Strict-Transport-Security` header (the baseline already
advertised `preload`), every subdomain, and certificate renewal path. Decide whether
`includeSubDomains`/preload remains acceptable. For DNSSEC, first enable signing in Cloudflare and
record the generated DNSKEY/DS values; then publish that exact DS in the resolved registrar; then
verify the parent and Cloudflare chain. Add or alter CAA only after listing every legitimate edge
and origin issuer. Do not submit a preload change, delete a DS record, or narrow CAA speculatively.

```bash
dig +dnssec kovagpt.com DNSKEY
dig +short kovagpt.com DS
dig +short kovagpt.com CAA
curl --silent --show-error --head https://kovagpt.com/ | grep -i '^strict-transport-security:'
```

**Risk:** a wrong DS, CAA, HSTS, or preload decision can make the domain unreachable or block
certificate renewal for an extended period. **Consequence of not performing:** DNSSEC remains
unproven and no new preload/CAA claim may be made; this must be recorded as residual risk.
**Evidence already collected:** no DNSSEC or CAA was observed; a preload-bearing HSTS header was
observed. **Automated work already complete:** read-only DNS/TLS inspection. **Rollback:** for
DNSSEC, remove the DS at the registrar first, wait at least its TTL, verify the parent no longer
serves it, and only then disable/delete Cloudflare signing. Restore exact prior CAA/Cloudflare
settings separately; HSTS preload cannot be treated as immediately reversible. **Exact proof
required:** resolved registrar/account ID, Cloudflare DNSSEC status/key tag/algorithm/digest type,
matching registrar DS, chain validation from two independent resolvers, registrar and Cloudflare
screenshots/IDs without account data, CAA renewal test, final HSTS header, and a dated owner
decision. See [Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/).

### MAN-05 — Create the live Stripe webhook only after billing and edge gates pass

- **Status:** `BLOCKED`
- **Kind:** permission, provider configuration, secret custody
- **Service/account/project:** Stripe live account `acct_1UAeDgAEZlsb6DBY`; Azure production Key
  Vault/app from MAN-01; Supabase project `mfbycmbjygcfkrsuepxf`
- **Owner:** authorized Stripe and Azure production operator
- **Prerequisites:** MAN-02 and MAN-03; merged billing fixes for durable completion/idempotency,
  authoritative Stripe object retrieval, customer ownership mapping, current invoice schema, and
  retryable 5xx on missing configuration or failed persistence; green
  `npm run release:stripe:contract`; full Stripe sandbox lifecycle through the production edge;
  ability to store and rotate the returned secret immediately. The operator must pre-prove that
  any event arriving during endpoint bootstrap receives a retryable 5xx, never a false 2xx/4xx.
- **Why manual:** there is no live endpoint, its destination-specific signing secret must be
  custodied in an authenticated Key Vault, and the current baseline still has billing source
  blockers. Creating an endpoint before all prerequisites would produce an unsafe live
  integration.

**Exact owner action**

1. In Stripe, turn off **View test data** and confirm account ID
   `acct_1UAeDgAEZlsb6DBY`. Re-read the catalog; do not create duplicate products/prices.
2. First prove the exact production route and raw-body path with a **sandbox** endpoint at
   `https://kovagpt.com/api/public/payments/webhook?env=sandbox`, its sandbox signing secret, and
   test-mode lifecycle events. Confirm duplicates, delay, out-of-order delivery, and database
   failure return behavior without any live object.
3. In live Workbench, create one account webhook destination at exactly
   `https://kovagpt.com/api/public/payments/webhook?env=live`, pinned to the API/event version
   supported by the deployed handler. Subscribe only to the deployed handler's reviewed event
   list. At the current source baseline that list is:
   - `checkout.session.completed`, `checkout.session.expired`
   - `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `customer.subscription.paused`,
     `customer.subscription.resumed`
   - `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.voided`,
     `invoice.marked_uncollectible`
4. Stripe v1 webhook creation returns an **enabled** endpoint. Immediately disable it and read the
   endpoint back as `disabled` before continuing. The already-deployed handler must return a
   retryable 5xx to any event in that short bootstrap interval; inspect deliveries and retain any
   such event for replay. If the operator cannot disable/read back promptly or the handler does not
   fail retryably, do not create the endpoint.
5. Reveal/retrieve the destination-specific live `whsec_…` value in owner-controlled Workbench and
   store it directly in the exact Key Vault secret object merged in IaC. The application
   environment name is `PAYMENTS_LIVE_WEBHOOK_SECRET`; Key Vault naming may use hyphens, so use the
   reviewed IaC name rather than guessing. Never echo, fingerprint, screenshot, or paste the
   secret.
6. Deploy the secret reference through managed identity and verify readiness reports Stripe
   configured without returning the secret. Re-read the endpoint as `disabled`, enable it, and
   read it back as `enabled`. Confirm every bootstrap-interval delivery was retried/replayed and
   durably completed before proceeding. Do not create a live Customer, Checkout Session,
   Subscription, PaymentIntent, charge, invoice, refund, dispute, or payout to test it.
7. Use a provider feature to send a signed live test only if Stripe explicitly confirms it creates
   no live financial/customer object and the chosen event cannot grant entitlement. Otherwise the
   signed-live-delivery gate remains blocked; a sandbox delivery is not mislabeled as live proof.

Check secret metadata without reading its value:

```bash
export AZURE_KEY_VAULT='<positively identified production Key Vault>'
export AZURE_WEBHOOK_SECRET_NAME='<exact Key Vault object name from reviewed IaC>'
az keyvault secret show --vault-name "$AZURE_KEY_VAULT" --name "$AZURE_WEBHOOK_SECRET_NAME" \
  --query '{id:id,enabled:attributes.enabled,created:attributes.created,updated:attributes.updated}' \
  --output json
```

**Risk:** wrong mode, URL, version, events, raw-body handling, secret, or persistence semantics can
silently grant/revoke entitlement or drop billing state. **Consequence of not performing:** live
billing must remain hidden/disabled; prices alone do not make billing ready. **Evidence already
collected:** correct live products/prices exist; no endpoint exists; source audit found release
blockers. **Automated work already complete:** catalog read and issue evidence; signature/event
contracts exist, but current exact-main code is not approved for live delivery.

**Rollback:** disable the Stripe endpoint first, return traffic to the prior application revision,
and retain both the endpoint configuration and old/new secret versions for replay analysis. Do not
delete event records or signing-secret versions during the rollback window. **Exact proof
required:** endpoint ID/mode/URL/API version/event list, disabled/enabled readbacks,
bootstrap-interval delivery/retry disposition, Key Vault secret version ID without value,
managed-identity access, sandbox signed delivery through Cloudflare/Azure, duplicate and failure
retry evidence, Stripe delivery status/correlation ID, and Supabase durable completion record.
Official reference: [Stripe webhooks](https://docs.stripe.com/webhooks).

### MAN-06 — Approve and configure customer-facing Billing Portal policy

- **Status:** `OWNER_REQUIRED`
- **Kind:** business, legal, financial, customer-policy decision
- **Service/account/project:** Stripe live account `acct_1UAeDgAEZlsb6DBY`
- **Owner:** authorized account representative, with legal/customer-support review; production
  operator implements only the recorded decision
- **Prerequisites:** approved Terms, cancellation/refund/support policy; green sandbox Portal flow;
  secure server-side customer ownership; MAN-05 green before any live use
- **Why manual:** no live Portal configuration exists, and cancellation, proration, plan changes,
  refunds, coupons, retention, customer fields, and public links are business/legal choices.

**Exact owner action:** record explicit choices for immediate versus period-end cancellation,
upgrade/downgrade timing, proration, eligible Plus/Pro products/prices, quantity changes, promotion
codes, retention offers, refund handling, cancellation reasons, payment-method updates, billing
address/name/email/phone/tax-ID editing, default return URL, support contact, headline, Privacy URL,
and Terms URL. Confirm that Plus and Pro are separate products and that the chosen Stripe Portal
transition behavior actually supports the intended path. Configure sandbox first, then live mode
with **View test data** off. Do not assume sandbox settings carry into live mode.

**Exact values to inspect:** live price IDs `price_1UAzhHAEZlsb6DBYWw2oUCeO` and
`price_1UAzhRAEZlsb6DBYlafU4mhc`; canonical return origin `https://kovagpt.com`; Stripe Dashboard
**Settings > Billing > Customer portal**; the deployed server's allowed return-URL contract.

**Risk:** a guessed configuration can misstate cancellation rights, create unexpected prorations,
or expose one customer's portal to another. **Consequence of not performing:** the Portal and live
checkout remain disabled; customer-facing copy must not claim self-service management.
**Evidence already collected:** no default live Portal configuration exists. **Automated work
already complete:** authenticated server-side Portal session code and return-URL validation exist,
but production ownership and policy behavior still require the merged billing fixes and sandbox
proof.

**Rollback:** restore the redacted prior Portal configuration if one exists; otherwise disable the
application Portal entry and live billing rather than guessing a new default. Do not delete live
customer data. **Exact proof required:** dated owner decision matrix, live Portal configuration ID
and redacted settings export, sandbox session ownership/isolation, allowed return behavior,
cancel/upgrade/downgrade outcomes, and legal/support link review. Official reference:
[Configure the Stripe customer portal](https://docs.stripe.com/customer-management/configure-portal).

### MAN-07 — Resolve tax, KYC, pricing, legal, and customer-communication authority

- **Status:** `OWNER_REQUIRED`
- **Kind:** legal, tax, financial, business, communication
- **Service/account/project:** Stripe account `acct_1UAeDgAEZlsb6DBY`; KovaGPT public legal/support
  surfaces; applicable legal entity and jurisdictions
- **Owner:** authorized adult/account representative; qualified lawyer and tax adviser where
  applicable
- **Prerequisites:** verified legal entity/account authority. Engineering must keep automatic tax
  and live charging disabled while this item is open.
- **Why manual:** software cannot infer identity, authority, tax nexus, registrations, age/privacy
  obligations, merchant category, banking/KYC facts, or approve customer-facing legal terms.

**Exact owner action**

1. Complete/confirm Stripe activation and KYC directly in Stripe, including authorized
   representative, entity, ownership, address, banking/payout, statement descriptor, merchant
   category, support contact, and public business details. Never put those details in GitHub.
2. Confirm in writing the existing prices—Plus USD 16/month and Pro USD 89/month—plus
   auto-renewal disclosure, free trial (if any), cancellation timing, refunds, failed-payment
   handling, support channel, and customer-communication/incident authority.
3. Have a qualified adviser decide tax nexus, product/service tax classification, registrations,
   collection dates, and invoices/receipts. Re-read preset code `txcd_10103000` and null product
   tax-code/tax-behavior state; do not change them without the recorded advice.
4. Register with each tax authority outside Stripe before adding a Stripe Tax registration. With
   zero registrations, keep `automatic_tax` disabled. Enabling tax for new flows does not
   retroactively update existing subscriptions/invoices.
5. Obtain qualified review of Terms, Privacy, age eligibility, data retention/deletion, AI
   disclosures, subscription/auto-renewal, cancellation/refund, and support copy. Record approval
   date/version without publishing private legal/KYC evidence.

**Risk:** unauthorized or incorrect attestations can create legal, tax, payout, consumer-protection,
or account-suspension exposure. **Consequence of not performing:** no real consumer charging, tax
collection promise, KYC-complete claim, or legally approved claim is permitted. **Evidence already
collected:** Stripe is capable, Tax settings are active, registrations are zero, and automatic tax
is not enabled in checkout source. **Automated work already complete:** technical catalog and tax
state were read without creating financial/customer objects.

**Rollback:** tax/legal registrations are not assumed reversible; follow adviser/provider
instructions. For application safety, disable checkout/Portal and automatic tax, preserve records,
and stop new charging without deleting existing customer obligations. **Exact proof required:** a
redacted dated approval record naming the authorized decision-maker/advisers, approved pricing and
policy matrix, Stripe activation status, registrations and effective dates (or explicit decision
to remain disabled), reviewed legal document versions, support/descriptor confirmation, and no
secret/PII in release evidence. Official references:
[Stripe Tax setup](https://docs.stripe.com/tax/set-up) and
[Stripe Tax registrations](https://docs.stripe.com/tax/registering).

### MAN-08 — Confirm Supabase-mediated Google OAuth end to end

- **Status:** `OWNER_REQUIRED`
- **Kind:** authentication, provider permission, real-browser/account verification; legal/provider
  decision if consent publication or Google verification is required
- **Service/account/project:** Supabase project `mfbycmbjygcfkrsuepxf`; the Google Auth Platform
  project/client configured on its Google provider page; production origins `https://kovagpt.com`
  and `https://www.kovagpt.com`
- **Owner:** Google OAuth project owner and Supabase project owner; a disposable owner-approved QA
  Google account performs the browser test
- **Prerequisites:** MAN-03; exact production SHA; Google provider enabled with an owner-controlled
  client secret; redacted backup of current Google/Supabase Auth settings; no Cloudflare challenge
  or cache on callback paths
- **Why manual:** this execution cannot enter the Google project, pass account selection/MFA,
  publish/verify a consent screen, or authorize a real QA identity.

Kova supplies Supabase with the application-side
`redirectTo=https://kovagpt.com/~oauth/callback`; Supabase then invokes Google with its own
`redirect_uri`. The two callbacks have different jobs:

- Google **Authorized redirect URI:**
  `https://mfbycmbjygcfkrsuepxf.supabase.co/auth/v1/callback`
- Google **Authorized JavaScript origin:** `https://kovagpt.com` (add `https://www.kovagpt.com`
  only if the production flow truly starts there before canonical redirect)
- Supabase **Site URL:** `https://kovagpt.com`
- Supabase **Redirect URLs allowlist:** exact
  `https://kovagpt.com/~oauth/callback`

Do not replace the Supabase callback in Google with the Kova callback. Do not use a wildcard for
the production callback. Keep staging/local clients and redirect lists separate.

**Exact owner action**

1. In Supabase **Auth > Providers > Google**, identify the configured Web client without exposing
   its secret and copy the provider-displayed callback URL. Confirm it equals the Supabase callback
   above.
2. In the matching Google Auth Platform client, verify exact JavaScript origins and redirect URIs,
   consent mode, test users, verified domain, app name/logo, support email, Privacy URL, Terms URL,
   scopes, and publishing/verification status. Remove stale production wildcards only after a
   successful exact-path test.
3. In Supabase **Auth > URL Configuration**, verify the Site URL and exact redirect allowlist above.
4. From a fresh private browser on an external network, start at an innocuous authenticated route,
   choose **Continue with Google**, and inspect the outbound authorization request. Its decoded
   Google `redirect_uri` must be the Supabase callback. Complete consent with the disposable QA
   user, return through Kova's callback, verify one Supabase session/user, restore the original
   relative route, refresh, sign out, and prove the session is gone.
5. Repeat the start/canonicalization check on `www`; verify path/query preservation and no redirect
   loop. Confirm authorization codes/tokens are removed from the address bar and absent from
   Cloudflare, Azure, application, analytics, screenshots, and HAR evidence.

**Risk:** a wrong callback/client/consent state can block login, leak credentials through logs, or
authorize the wrong app. **Consequence of not performing:** Google sign-in must be hidden or shown
as unavailable; provider-enabled state alone is not production proof. **Evidence already
collected:** Google appeared enabled in Supabase and source has callback/session scrubbing, but no
successful production round trip was recorded. **Automated work already complete:** OAuth state,
safe-relative redirect, callback cleanup, and source contracts exist.

**Rollback:** restore the backed-up Google client and Supabase Auth configuration; if safe recovery
is uncertain, disable the Google provider and hide its control rather than removing a possibly
working callback. Revoke only the disposable QA grant, not unrelated user grants. **Exact proof
required:** redacted client ID suffix/project ID, exact origin/redirect lists, consent status,
UTC-tested QA identity alias, sanitized network sequence, successful Supabase session/user,
post-auth route restoration, refresh persistence, sign-out, no secrets in URLs/logs, and provider
audit-log pointers. Official references:
[Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google) and
[Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

### MAN-09 — Decide whether Maps may become a real release surface

- **Status:** `OWNER_REQUIRED` if Maps is desired; otherwise record the decision to keep it
  unavailable
- **Kind:** provider, legal/licensing, privacy, cost, product decision
- **Service/account/project:** Kova route `/maps`, browser geolocation permission, and the currently
  referenced OpenStreetMap tile path; no approved production maps provider/account was verified
- **Owner:** authorized product owner with legal/privacy/licensing review; production operator only
  configures an explicitly approved provider
- **Prerequisites:** engineering must first hide or truthfully disable `/maps`, its navigation and
  geolocation/provider network calls while this item is open. That fail-closed engineering change
  does not belong in this manual handoff.
- **Why manual:** a provider, license/attribution terms, legal basis for location, privacy behavior,
  and no-cost capacity cannot be inferred or accepted by automation.

**Exact owner action:** choose one of two outcomes. The safe zero-spend default is **Maps remains
unavailable**, with no geolocation request and no tile/API call. If Maps is still desired, identify
the exact provider/account and have an authorized reviewer approve its current production terms,
tile/API usage policy, attribution, rate/capacity limits, `$0` incremental cost, geographic/data
processing, consent and denial behavior, retention, deletion, third-party disclosure, and support
path. Do not treat the public OpenStreetMap tile service as an implicit production SLA or license
approval, and do not create/purchase a provider account under this handoff.

For the unavailable decision, verify production is fail-closed:

```bash
curl --silent --show-error --dump-header - --output /tmp/kova-maps.html \
  https://kovagpt.com/maps
```

The result must be a generic 404/410 or a truthful unavailable surface with no geolocation prompt,
map tiles, provider request, advertising claim, or user-data mutation. A visible working map while
this item is open is a release blocker.

**Risk:** unapproved map traffic can violate tile-provider terms, leak IP/location data, prompt for
location without an approved purpose, create unbounded usage/cost, or imply a nonexistent SLA.
**Consequence of not performing:** Maps remains hidden/disabled; the rest of KovaGPT may release
only if no Maps control/claim/network path is exposed. **Evidence already collected:** Maps was
visibly advertised, browser geolocation and OpenStreetMap traffic were present, and no approved
provider/legal/no-cost production contract was proven. **Automated work already complete:** source
and production surface inspection identified the gate; hiding/fail-closing remains an engineering
prerequisite.

**Rollback:** disable the feature/provider configuration, remove navigation/claims, revoke only the
Kova maps credential if one was explicitly created, stop geolocation requests, and preserve any
required privacy/deletion records. **Exact proof required:** dated unavailable-or-approved owner
decision; if unavailable, route/UI/network/geolocation absence; if approved, exact provider/account
ID, terms/version, attribution, privacy/legal review, capacity and `$0` cost proof, denied-permission
behavior, rate-limit behavior, and provider audit-log pointers.

### MAN-10 — Run production smoke, physical-browser checks, and assemble exact-release evidence

- **Status:** `BLOCKED`
- **Kind:** real-browser/account, hardware/browser, visual approval, protected production evidence
- **Service/account/project:** `https://kovagpt.com`, `https://www.kovagpt.com`, exact Azure
  revision/image, Cloudflare zone, Supabase project, Stripe sandbox/live configuration, GitHub
  release record
- **Owner:** production release operator; owner-approved QA users; authorized visual/accessibility
  reviewer; physical Safari/iPhone operator where no no-cost connected device service exists
- **Prerequisites:** MAN-02 and MAN-03; MAN-05/MAN-06/MAN-07 only if billing is to be visible;
  MAN-08 only if Google is to be visible; MAN-09 approved only if Maps is to be visible; exact
  SHA/digest/revision recorded; disposable QA accounts and cleanup plan; no unresolved blocker
- **Why manual:** authenticated production checks require real owner-approved accounts and a
  network/browser/device unavailable to this execution. Subjective visual approval and physical
  Safari/screen-reader checks require a human.

**Exact owner action**

1. From the exact release checkout, run the anonymous production suite and immutable deployment
   smoke against the public Cloudflare hostname:

   ```bash
   export KOVA_RELEASE_SHA='<deployed 40-character SHA>'
   KOVA_SMOKE_BASE_URL=https://kovagpt.com KOVA_EXPECTED_SHA="$KOVA_RELEASE_SHA" \
     npm run smoke:deployment
   KOVA_PRODUCTION_URL=https://kovagpt.com npm run test:e2e:production
   ```

2. Verify exact identity independently:

   ```bash
   curl --fail --silent --show-error --dump-header /tmp/kova-version-headers.txt \
     --output /tmp/kova-version.json https://kovagpt.com/api/version
   test "$(jq -r .sha /tmp/kova-version.json)" = "$KOVA_RELEASE_SHA"
   grep -i "^x-kova-build: $KOVA_RELEASE_SHA" /tmp/kova-version-headers.txt
   grep -i '^cache-control:.*no-store' /tmp/kova-version-headers.txt
   grep -i '^cf-ray:' /tmp/kova-version-headers.txt
   ```

3. With two disposable QA users, prove sign-in/sign-out, owner-isolated Projects/Library/memory,
   upload/download/delete, sharing authorization, temporary-chat non-persistence, account export
   claims, account deletion safeguards, session revocation, streaming and abort, retry/error paths,
   scheduled/worker behavior, and server-enforced plan/model/quota boundaries. Clean up created
   records in `finally`; do not use customer PII.
4. Exercise billing only in Stripe sandbox through the production edge. Prove success/cancel,
   decline, SCA, async success/failure, upgrade/downgrade, cancel, renewal, duplicate/delayed/out-of-
   order webhook, reconciliation drift, and Portal ownership. Confirm zero live customer/payment
   object was created. If authorized live billing evidence cannot be obtained within the legal
   boundary, billing remains disabled and the platform is not declared fully complete.
5. Complete MAN-08 for visible Google sign-in. Test desktop/mobile Chrome/Firefox/Safari as
   available, physical iPhone Safari, keyboard-only operation, zoom/reflow, reduced motion,
   contrast, focus, touch targets, VoiceOver or another real screen reader, long content, slow
   network, and disconnect/reconnect. Record a separate subjective visual approval.
6. Monitor Azure revision/probes/logs/metrics, Cloudflare analytics/security events, Supabase logs,
   and Stripe deliveries during the observation window. Prove alert visibility without sending
   customer communications or paid provider requests.
7. Rehearse rollback in staging. For production, either perform an owner-approved no-impact
   rollback drill or record the exact explicit commands, prior revision/digest, DNS/rule IDs, secret
   versions, recovery time, and decision not to disturb healthy production.

**Risk:** production tests can mutate or expose real data, trigger provider cost, or disrupt users
if QA isolation fails. **Consequence of not performing:** exact production, accessibility, browser,
auth, provider, and rollback gates remain unproven. **Evidence already collected:** exact-main CI
failures and unknown deployed SHA demonstrate why this gate is open. **Automated work already
complete:** local/source suites and production test harnesses exist; they have not proven the exact
deployment.

**Rollback:** stop the smoke immediately on unexpected mutation/charge, disable the affected
feature, revoke disposable sessions, preserve correlation IDs/logs, remove only QA-created data,
and follow MAN-02/MAN-03/MAN-05 rollback order. **Exact proof required:**

| Proof           | Minimum artifact                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source          | exact commit URL/SHA, green required checks, reviews/threads, clean release tree                                                                         |
| Image/Azure     | ACR digest, staging and production revision, traffic, probes/readiness, Key Vault/identity metadata, logs                                                |
| Cloudflare      | zone/record/rule IDs, proxy flags, `CF-Ray`, Full (strict), cache/WAF results, raw-origin missing/wrong-cert denial                                      |
| Public identity | `/api/version` JSON SHA, `X-Kova-Build`, `no-store`, apex/`www` redirect and TLS                                                                         |
| Data/Auth       | two-user owner isolation, cleanup, session/logout, Google OAuth sequence if visible                                                                      |
| Billing         | catalog IDs, sandbox lifecycle, webhook delivery/idempotency/retry, zero unintended live objects; live endpoint/Portal/tax evidence only when authorized |
| UX/security     | browser/device matrix, console/network errors, accessibility, responsive/visual approval, security headers, streaming/uploads                            |
| Operations      | observation window, alerts/logs, backup/restore evidence, staging rollback and exact production rollback target                                          |

Evidence must name the exact SHA/digest/revision, UTC timestamps, operator, environment, command or
workflow run, result, artifact checksum/link, and cleanup result. Redact all secrets and PII. Do not
create a release/tag or close canonical issue #197 until every applicable production gate is
proven.

### MAN-11 — Resolve the truncated original specification

- **Status:** `OWNER_REQUIRED`
- **Kind:** product/specification authority
- **Service/account/project:** the owner's authoritative KovaGPT final-goal source. The supplied
  767-line copy ends in Section 9, **Search and Citations**, immediately after “support mobile.”
- **Owner:** the person or organization authorized to define and accept KovaGPT's product scope
- **Prerequisites:** preserve the truncated copy and the reconstructed scope/evidence index used
  for this closure effort; do not delay unrelated autonomous work while this item is open
- **Why manual:** only the specification owner can supply the missing authoritative text or decide
  that the repository-, issue-, provider-, and production-derived reconstruction is the complete
  intended scope. Automation cannot invent that authority.

**Exact owner action:** choose and record one outcome. Either (A) provide the canonical continuation
or complete untruncated specification, identify its source/version, and confirm that it continues
from the exact final visible text; or (B) state explicitly that no continuation is available or
required and approve the reconstructed scope sources named in the governing mandate as the
authoritative completion scope. For outcome A, the release owner must create a requirement-delta
matrix mapping every newly supplied requirement to a route/control, issue, test, production proof,
or an honest `BLOCKED`/`OWNER_REQUIRED`/reasoned `NOT_APPLICABLE` disposition. New requirements do
not inherit a pass from earlier work.

For a supplied artifact, record non-secret integrity and continuity checks such as:

```bash
sha256sum '<canonical complete specification>'
wc -l '<canonical complete specification>'
tail -n 30 '<preserved truncated specification>'
sed -n '750,790p' '<canonical complete specification>'
```

**Risk:** accepting a wrong revision can add unauthorized scope; accepting the truncation as
complete without owner authority can omit release-critical requirements. **Consequence of not
performing:** KovaGPT may not be declared fully compliant with the original specification, and
canonical issue #197 must remain open, although other independent release gates may continue.
**Evidence already collected:** the governing mandate identifies the 767-line cutoff and requires
this handoff item if the missing continuation remains unresolved. **Automated work already
complete:** visible requirements were treated as binding minimums and remaining scope was
reconstructed from the repository, routes/APIs, schema, issues/PRs, production behavior, provider
configuration, navigation/SEO, tests, documentation, and artifacts.

**Rollback:** no provider mutation is involved. If the supplied artifact or owner decision is later
shown to be wrong, supersede the scope record without deleting it, reopen every affected gate, and
re-triage the delta. **Exact proof required:** owner identity/authority and UTC decision; either the
canonical artifact/link, version and SHA-256 plus prefix/continuity confirmation and completed
delta matrix, or an explicit no-continuation approval naming the reconstructed scope sources and
why they are sufficient; affected issue/test/evidence links; and confirmation that no new
requirement was silently marked complete.

## Copyable checklist for the KovaGPT Manual conversation

- [ ] Sign in to and positively identify the KovaGPT Azure tenant/subscription/resources,
      Cloudflare `kovagpt.com` account/zone, and GitHub protected environments; capture redacted
      inventory and rollback state. (`MAN-01`)
- [ ] Wait for one exact reviewed `main` SHA to have every required green check and no unresolved
      P0/P1/P2; correct the Wrangler staging workflow and unsafe/incomplete Azure deployment
      contracts; record the immutable ACR digest and green Azure staging evidence.
- [ ] Prove a `$0`, exact-resource, full-runtime Azure `what-if`; deploy the same digest only in the
      non-enforcing client-cert accept/audit phase, record the new/previous revisions, and verify
      exact `/api/version`/`X-Kova-Build` plus liveness/readiness. (`MAN-02`)
- [ ] Upload/associate a per-hostname Cloudflare AOP leaf certificate for apex and `www`; proxy both
      hostnames with Full (strict), wait the prior DNS TTL, and prove Azure observes the exact leaf
      SHA-256 hash. (`MAN-03`)
- [ ] Only after proxy/AOP proof, require the client cert in Azure and enforce its hash in Kova;
      preserve OAuth/webhook path+query/raw bodies, exclude private/protocol paths from cache and
      interactive challenge without a blanket WAF bypass, and prove raw-origin missing/wrong cert
      denial.
- [ ] Decide DNSSEC registrar DS, HSTS preload/includeSubDomains, and CAA only after complete
      subdomain/issuer review. (`MAN-04`)
- [ ] After billing code, edge, Key Vault, and sandbox lifecycle gates pass, create the exact live
      Stripe webhook in `acct_1UAeDgAEZlsb6DBY`; store its unique secret only in Key Vault and do not
      create a live customer/payment object for testing. (`MAN-05`)
- [ ] Approve Portal cancellation, proration, upgrade/downgrade, coupon/retention/refund, customer
      field, support, return URL, Privacy, and Terms behavior; configure sandbox before live. (`MAN-06`)
- [ ] Have the authorized representative/legal/tax advisers approve KYC/entity, prices,
      auto-renewal, cancellation/refund/support/descriptor, privacy/age/Terms, nexus, tax codes, and
      registrations. Keep automatic tax and charging disabled until then. (`MAN-07`)
- [ ] Verify Google uses the Supabase callback in Google and Kova's callback in Supabase's exact
      redirect allowlist; complete a sanitized real-browser sign-in/session/logout test. (`MAN-08`)
- [ ] Decide whether Maps remains unavailable or receives explicit provider/licensing/privacy and
      `$0`-capacity approval; while open, prove no visible control, geolocation, or provider traffic.
      (`MAN-09`)
- [ ] Run exact-production anonymous/authenticated smoke, two-user isolation, Stripe sandbox,
      physical Safari/iPhone, accessibility/visual, monitoring, cleanup, and rollback evidence.
      (`MAN-10`)
- [ ] Supply the canonical continuation/full original specification after Section 9 “support
      mobile” and triage its complete delta, or explicitly approve the reconstructed scope as
      authoritative; keep #197 open until one outcome has exact proof. (`MAN-11`)

Until every applicable item is proven: **Maximum autonomous work completed; KovaGPT is not yet
fully complete because the owner-required gates above remain.**
