# Production operation approval packets (source draft, September 24, 2026)

These are the **individual operations to present for separate owner approval**, not
authorization to execute them. Each request must be updated with the reviewed
`main` SHA, resource IDs, affected data, current quote and maximum spend, operator,
time window, evidence location, and rollback target immediately before execution.
Approval of a PR or an earlier operation does not approve the next operation.
No M18–M24 milestone is completed by this document. The nineteen migration
mappings remain `requires_schema_proof` until their full acceptance evidence passes.

## Identity and zero-write inventory before each request

Run from an exact clean `main` checkout. Keep credentials in protected environment
secrets and avoid logging database URIs, keys, object names, user IDs, or payloads.
Read-only inventory may identify resources, hashes, counts, and revision metadata.

```bash
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --porcelain
az account show --query '{subscription:id,tenant:tenantId}' --output json
az containerapp show --resource-group "$PROD_RG" --name "$PROD_APP" \
  --query '{id:id,name:name,revisionMode:properties.configuration.activeRevisionsMode,traffic:properties.configuration.ingress.traffic}' --output json
az containerapp revision list --resource-group "$PROD_RG" --name "$PROD_APP" \
  --query '[].{name:name,active:properties.active,image:properties.template.containers[0].image,created:properties.createdTime}' --output json
```

On September 24, a signed-in, read-only Azure portal inspection showed the
subscription `ab732127-11c3-46a7-a1cb-6ee8d86594f4`, production group
`rg-kovagpt-prod`, production app `kovagpt-prod-web`, staging group
`rg-kovagpt-staging`, staging app `ca-kovagpt-staging`, and Standard ACR registry
`kovagptacr` in `rg-kovagpt-dev` (login server
`kovagptacr-dte9hugbhjghcyb8.azurecr.io`), all in East US. The exact production
app ID observed was
`/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/containerApps/kovagpt-prod-web`.
Both web apps were **stopped**. Production showed one active, stopped revision
`kovagpt-prod-web--price80-675bccd3` at zero replicas (`minReplicas=0`,
`maxReplicas=4`) with a configured 100% allocation, plus 19 inactive revisions.
The protected PLAN must set `KOVA_PRODUCTION_ACR_RESOURCE_GROUP` to the
independently confirmed registry group and match the Bicep parameter; its
read-only registry lookup must confirm the exact resource ID in the signed-in
subscription and the protected login server. This is a deliberate exception
for the existing registry, not permission to target a dev Key Vault or app.
Neither the configured allocation nor the inactive list proves a healthy
previous digest or an actual rollback. The `kovagpt-scheduled-execution` job in
`rg-kovagpt-prod` had a Manual trigger; it was not run.

Cost Management displayed **$26.17 USD** actual September charges against an
existing **$25/month warning budget**, a **$36.36** month-end forecast, and
**$26.13** attributed to Container Apps. This is an account observation, not an
account-specific unit-rate quote, a free-capacity assertion, or a spending cap.
Before filling a request, cross-check the portal identities in the protected
CLI session, fetch current meter prices, fix its exact numeric ceiling, and
review current revision image digests, origin protection and the complete
private property diff. A successful PLAN must verify the existing app's full
resource identity in that same subscription. Do not assume a healthy previous
revision exists.

## Approval sequence and bounded commands

| Gate                             | Exact proposed operation after prerequisites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Stop and acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M18 isolated recovery            | Use the separately reviewed encrypted-backup, managed `auth`/`storage` customization, Storage-object, and provider/key recovery packet against a positively identified **isolated** target. This is a separate restore and any paid-project approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Abort on unavailable passphrase, missing bytes/configuration, target ambiguity, checksum mismatch, or managed schema conflict. Accept only a successful real-backup restore plus application/auth/Storage checks; a synthetic structural replay does not count.                                                                                                                                                          |
| M19 Azure rollback exercise      | After a separately approved multi-revision setup, record both immutable digests and the before weights. A separately approved bounded canary must give the candidate **nonzero traffic** and pass checks. Then, under a specific rollback approval, run `az containerapp ingress traffic set --resource-group "$PROD_RG" --name "$PROD_APP" --revision-weight "$PREVIOUS_REVISION=100" "$CANDIDATE_REVISION=0"`. Activating an inactive revision is another separately approved operation.                                                                                                                                                                                                                                                                                                                                  | Confirm the actual nonzero-to-zero candidate weight transition, previous immutable image, authenticated origin `/api/livez`, `/api/readyz`, `/api/version`, edge path, auth, and database compatibility; record before/after weights, timestamps and recovery time. Halt if the app is single-revision, previous digest is unavailable, or exposure exceeds the approved canary. A 0%-to-0% switch is no rollback proof. |
| M20 production database          | Accept M12 and M13 first, re-capture the exact live ledger/catalog, verify all nineteen mappings and 80 pending forward bodies plus the three equivalence decisions, and pass full isolated upgrade and real-backup compatibility. Present the final ordered version/hash manifest and reviewed canonical history recording mechanism **before** invoking `SUPABASE_PROJECT_REF=mfbycmbjygcfkrsuepxf npm run db:migrate -- --include-all` on the approved SHA, after a new reviewed source guard accepts that exact write.                                                                                                                                                                                                                                                                                                  | Reject a changed ledger or target ref, missing backup, absent history mechanism, unknown lock/runtime, or incompatible old app. Do not run `db:migrate` now: it links and pushes to the hosted database. Capture before/after ledger digests and independently validate row counts and privileges. History repair needs its own explicit authorization.                                                                  |
| M21 production candidate         | On the approved, current `main` SHA, dispatch `gh workflow run build-azure-production-candidate.yml --ref main -f confirmation=BUILD_ONLY -f source_sha="$REVIEWED_SHA"`. This is an ACR write and paid build request, independent of a PR merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Protected environment reviewer, registry role, no tag watcher, exact source/tree/browser ref, unique tag, and cost ceiling must pass. Accept only a successful run's immutable `repository@sha256:digest`, extracted browser provenance, and run/artifact IDs. The build does not deploy.                                                                                                                                |
| M22 PLAN then staging            | On the same SHA/digest, dispatch `gh workflow run validate-azure-production.yml --ref main -f confirmation=PLAN -f image_reference="$CANDIDATE_IMAGE"`. PLAN emits a resource-ID summary; obtain a separate protected full-payload diff before any apply. For a separately built staging-specific digest/parameters, run `az bicep build --file infra/azure/staging/main.bicep` and `az deployment group what-if --resource-group "$STAGING_RG" --template-file infra/azure/staging/main.bicep --parameters @"$STAGING_PARAMETERS"`. Separately approve any staging creation/update: `az deployment group create --resource-group "$STAGING_RG" --template-file infra/azure/staging/main.bicep --parameters @"$STAGING_PARAMETERS"`. Once externally deployed, dispatch `gh workflow run staging-rehearsal.yml --ref main`. | PLAN is non-deploying. Staging deployment is an Azure mutation and staging rehearsal writes disposable test data. Require exact runtime SHA, browser target, smoke/auth/isolation/e2e cleanup and administrator diagnostics; the current rehearsal reports diagnostics `not-run` and cannot yet pass the production guard. A staging-built browser image cannot serve as the production candidate.                       |
| M23 production apply and cutover | After the source template models **all** current environment settings/secret references, roles, budget controls, protected origin and a tested multi-revision rollback, publish and review a distinct apply PR. Present the literal reviewed `az deployment group create` or dedicated workflow invocation, exact resource IDs and what-if diff, prior digest, initial zero-traffic revision, health evidence, then the separately approved Cloudflare/traffic steps.                                                                                                                                                                                                                                                                                                                                                       | The current repository has **no authorized production apply path**; its Bicep uses single-revision mode and the PLAN workflow has no deploy step. Never run a guessed `create` command. Stop on any unplanned resource change, automatic traffic shift, missing previous revision, origin-auth failure or unexpected cost.                                                                                               |
| M24 acceptance                   | Observe the exact Azure revision/digest, `/api/livez`, `/api/readyz`, `/api/version` source SHA, Cloudflare canonical host, raw-origin denial, auth and isolation, streaming/uploads, provider and billing gates, cost telemetry and rollback evidence during the approved window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Sign off only after actual live behavior and full evidence from the exact deployed SHA. Restore prior traffic by the separately approved rollback operation on failure; database restore is an additional incident decision.                                                                                                                                                                                             |

**M20 order hazard:** `scripts/release/supabase-db-push.mjs` links the hosted
project and immediately runs `supabase db push --linked`. Against the present
98-row remote ledger **83** source timestamps are absent. The default
push may skip older out-of-order versions; `--include-all` would include all
83, including a duplicate security body. The proposed sequence instead
requires **three history-only records first**, followed by only **80**
executable bodies. In the isolated test, re-executing the
already-applied security body `20260903145843` failed with SQLSTATE `42723`.
The passing `--canonical-history` command repairs **local** history only and
does not make `db:migrate` safe against production. Independently review and
separately approve a protected production recording mechanism for the three
equivalent versions, verify their recorded statements and exactly **101**
remote ledger rows at the same approved checkpoint, then run an
**approved read-only** `npm run db:migrate -- --include-all --dry-run` against that exact
linked target and verify it selects exactly the remaining **80** source
versions in approved order. Review every pre-state contract before presenting
a runnable production push. Reject a raw `db:migrate` invocation against a
98-row ledger; a failed push could leave partial production changes.

The M19 command is **not runnable under the current single-revision production
template**. Multi-revision strategy, prior healthy image, maintenance window, and
specific approval must precede it. The current staging template is also
single-revision. A reviewed source change and separately approved staging mutation
must first establish two revisions and exercise an actual nonzero candidate weight
returning to the previous revision. A separate, limited production pre-cutover
setup must establish a healthy previous revision, protected candidate revision,
multi-revision ingress with explicit traffic weights, and a bounded canary under
individual Azure mutation and traffic approvals. Only a measured production
nonzero-to-zero candidate transition with recovery checks can satisfy M19; the
final M23 traffic cutover follows later. If a safe canary cannot be arranged,
M19 remains blocked and M23 cannot be claimed. M20's 80-body queue is a proposal, not a
verified or approved production sequence. Recheck the source and live ledger on
the final approved SHA; the isolated 180-version rehearsal intentionally omits the
canonical record-only security entry, while the proposed full ledger has 181.

The protected PLAN deliberately prints `ResourceIdOnly`, which cannot expose
ingress, environment, secret-reference, or traffic property changes. Before an
apply request, a separate authorized reviewer must run the same SHA, template,
target and parameter file inside a protected, short-lived runner:

```bash
umask 077
az deployment group what-if \
  --resource-group "$PROD_RG" \
  --template-file infra/azure/production/main.bicep \
  --parameters @"$PROD_PARAMETERS" \
  --validation-level ProviderNoRbac \
  --result-format FullResourcePayloads \
  --output json > "$PRIVATE_WHAT_IF"
```

Keep the complete output out of Actions logs,
PR artifacts, chat, and the repository: full resource payloads can contain
sensitive values. Review a safely redacted property-level diff privately with a
second operator, compare it with the resource-ID summary, and record only the
approved change set and evidence hash. Stop if the private diff cannot be obtained
or any property change is unexplained. This step is read-only Azure planning;
any resource change still requires a separate explicit approval.

## Cost and stop limits to fill before approval

| Operation             | Billable exposure to quote from the actual subscription                                                                                   | Hard bound for the approval request                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M18 isolated restore  | Supabase isolated project/branch hours, storage and egress; optional provider usage.                                                      | Fixed target, max runtime in hours, deletion/cleanup plan, quoted hourly/GB rates, numeric currency ceiling.                                                                                                                                                                        |
| M19 rollback exercise | Container Apps active replica vCPU/GiB seconds and requests, telemetry, possible extra revision runtime.                                  | Max one candidate and one previous revision, max approved window, observed `minReplicas`/`maxReplicas`, computed ceiling.                                                                                                                                                           |
| M21 ACR build         | ACR Tasks billed runtime and retained image storage, possibly GitHub Actions minutes. Source builder timeout is 1,800 seconds.            | One build attempt, `1,800 × actual ACR task rate + image GiB × storage rate per day × approved retention days + CI minutes`, numeric ceiling; no retry without new approval. Specify retain-until/renew-by date for the uniquely tagged candidate and preserve any rollback digest. |
| M22 PLAN/staging      | PLAN runner minutes; staging Container Apps runtime/requests, Log Analytics/Application Insights, Key Vault and isolated Supabase target. | One approved staging deployment with scale and TTL, bounded rehearsal (workflow 60 minutes), actual meter rates and numeric ceiling; separately approve generation/provider calls.                                                                                                  |
| M23–M24 cutover       | Production app baseline replicas/requests, telemetry, provider requests, Cloudflare or other service plan charges.                        | Forecast from actual subscription rate and traffic, budget alerts verified, spend ceiling and stop time; generation initially disabled until a separate provider enablement decision.                                                                                               |

**No numeric Azure estimate is justified from source alone.** Azure's rates depend
on region, registry tier, actual subscription agreement, free-grant usage, runtime
resources, and traffic. Before each approval, attach the subscription's current
meter/rate quote, quantities and arithmetic, in its billing currency; reject a
missing quote or ceiling. A budget alert is evidence/notification, not a hard
spend cap. Relevant vendor rate schedules: [ACR pricing](https://azure.microsoft.com/en-us/pricing/details/container-registry/),
[Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing),
and [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/).

For M18, the September 23 isolated-restore runbook records a **historical**
Supabase branch quote of **$0.01344 per branch-hour** (two hours **$0.02688**,
before usage), and a **$0/month** new-project quote with no free-slot guarantee.
The September 24 read-only organization lookup found `Blockigaming's Org`
(`uwioudpaooagmhtdmokx`) on the Free plan, with no isolated branch. The
cost connector requires an explicit owner organization selection for a new
quote; none was received in this continuation. Neither historical amount
authorizes a clock-billed branch or a restore.

## Current approval boundary

This package permits source review, tests, and read-only identity capture. Request
separate specific owner approval before **each** merge, paid build/project action,
restore, Azure mutation, production database action, or deployment. Do not collapse
M18 restore, M19 rollback, M20 migration/history, M21 build, M22 staging, and M23
cutover into a blanket authorization. The exact operations must include filled
identifiers, cost ceilings, and stop conditions when presented to the owner.
