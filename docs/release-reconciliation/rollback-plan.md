# KovaGPT production rollback plan

## Private configuration capture (separate read approval)

`scripts/azure/capture-production-configuration.mjs` fills the collection gap
between a private ARM response and the offline rollout generator. Importing it
and running its mocked tests make no cloud requests. Collection is **not**
authorized by source publication or by this document.

After approval of an exact clean source commit, use this bounded command with a
new destination beneath an existing owner-only directory outside Git:

```bash
perl -e 'alarm 90; exec @ARGV' node scripts/azure/capture-production-configuration.mjs \
  --execute-approved-read APPROVED_40_CHARACTER_SOURCE_SHA /private/approved-parent/new-capture
```

The executable is fixed to `kovagpt-prod-web` in `rg-kovagpt-prod`, subscription
`ab732127-11c3-46a7-a1cb-6ee8d86594f4`. It does not touch the Auth rehearsal app.
It uses the existing Azure CLI session to obtain an in-memory ARM token (15s),
then at most three single-attempt HTTPS GETs (20s each, 80s overall collection):

1. Container App GET, API `2025-01-01`.
2. GET the exact `latestReadyRevisionName` from that response, under the same app.
3. Repeat the same app GET once to detect configuration drift, **not as a retry**.

TLS verification stays enabled. There are no redirects, retries, pagination,
`listSecrets`, Key Vault reads, registry pulls, database/app requests, starts,
configuration writes, builds, or deployments. A stopped/unhealthy revision is
evidence of a blocked prerequisite, never authority to start it. No charges are
incurred by these control-plane metadata reads; existing app runtime is unchanged.

The directory is 0700; three full response files and the incrementally durable
receipt are 0600. Inline environment configuration may be sensitive: never print,
publish, commit, or upload these files. Tokens are never stored in them or passed
in arguments. CLI errors are fixed sanitized codes. Preserve partial captures;
an existing destination is rejected and an uncertain dispatch must not be replayed.
The token reference is released and the process exits; this does not claim
cryptographic JavaScript memory erasure. No credential reset or sign-in is run.

The offline `capturedRolloutInput(capture, scope, canary)` bridge validates the
receipt and document hashes, then invokes the **unchanged** rollout checker.
Supply the real approved release SHA, immutable previous/candidate images and
canary window. Do not invent those inputs to turn capture into rollout readiness.
Captured app settings are never normalized or defaulted. Explicit ARM `null`
values for optional IP restrictions and client-certificate mode are preserved
exactly; an absent field still fails the full-capture contract. An empty registry
password reference is accepted only alongside that registry's explicit managed
identity, and is likewise preserved. Neither rule accepts empty environment
secret references, missing secret material, an `Activating` revision, or app/revision
template drift. In particular, do not silently equate missing ephemeral storage
or null scale timing with a current app's populated defaults.

Azure's
[2025-01-01 secret contract](https://github.com/Azure/azure-rest-api-specs/blob/main/specification/app/resource-manager/Microsoft.App/ContainerApps/stable/2025-01-01/CommonDefinitions.json)
marks inline secret values create/update-only. If GET omits a needed inline value,
or a Key Vault reference is unversioned/incomplete, the existing full-resource
generator continues to reject it. A separately reviewed protected value source or
reference-preserving operation would be necessary; `listSecrets` is not implicit.

Likewise a mutable image tag, missing probes/origin controls, unhealthy previous
revision, mismatched template or configuration drift remains blocked. Capture
does not accept M19/M22/M23. Its five-minute observation freshness must be renewed
under a future exact release authorization immediately before any rollout, even
if this earlier read resolves configuration preparation. This operation creates
no cloud resource to roll back; cleanup retains private evidence only.

## Required evidence

Before promotion, create a JSON evidence file and validate it with:

```bash
node scripts/release/rollback-evidence.mjs --write-template artifacts/rollback-evidence.json
KOVA_ROLLBACK_EVIDENCE_FILE=artifacts/rollback-evidence.json npm run release:rollback:check
```

The evidence must bind:

- exact release Git SHA;
- candidate Azure image digest;
- previous known-good image digest;
- candidate and previous Container App revisions;
- database backup/PITR reference;
- database forward/backward compatibility decision;
- auth migration state;
- current Cloudflare origin/routing state;
- reviewed restore and verification commands.

## Application rollback

The offline preservation prerequisite is available as:

```bash
node scripts/azure/revision-preservation.mjs /private/path/revision-review.json
```

The input is an owner-only, nonsymlink JSON file (maximum 4 MiB), never a command
argument containing configuration. Its `baseline` and `desired` are complete
private resource documents, with the prior revision document in `previousRevision`.
`scope` contains `schemaVersion: 1`, the reviewed `sourceSha`, exact production
`targetResourceId`, `containerName`, `previousRevision`, immutable `previousImage`
and `candidateImage`, and `candidateSuffix`. The checker permits only a switch to
Multiple mode, explicit 100% traffic on the prior revision, the candidate image and
its suffix. Everything else must be identical, including unknown fields, environment,
secrets/references, identity, probes, origin controls, sidecars and replica limits.
It rejects stopped/ambiguous baselines and missing or unhealthy prior revisions.
The output contains only allowlisted identities and results, not private values.

This is a local review, **not an ARM deployment document or executable apply path**.
Current authorized captures, independent full-property review, source/image
provenance, database/Auth backward compatibility and origin/edge evidence remain
required. A second active revision may cost more even with unchanged scale settings;
the checker does not establish a zero-cost entitlement. A private, approved canary
must still prove the candidate. Never apply the cost-frozen zero-replica/no-ingress
Bicep to the running service. No template, replica, traffic or environment change
is authorized by this check.

### Offline rollout request generation (M19 / M22 / M23 source prerequisite)

The preservation checker now has a separate request generator. It makes **zero
cloud requests**, does not execute the requests it generates, and does not use
Azure credentials:

```bash
node scripts/azure/revision-rollout-plan.mjs /private/path/rollout-input.json /private/path/new-rollout-plan.json
```

Input must be an owner-only regular file, at most 4 MiB. Output must not exist and
its parent must be owner-only (0700). The new plan is written with mode 0600.
Neither configuration nor errors containing private values are printed. Do not
put this plan, input, or its secure-object parameters in Git, logs or artifacts:
they preserve supplied secret values/references and other private configuration.

Required input contract:

- `baseline`: complete supplied Container App document, including location, tags,
  identity, registries, complete secrets, ingress/origin controls, containers,
  environment, probes, scale and optional sidecars/init containers/volumes.
  An ordinary redacted secret-name inventory is insufficient. A secret needs
  either its supplied value or a versioned Key Vault URI and identity. No secret
  is retrieved by this tool.
- `previousRevision`: the exact previous revision document, active, healthy,
  running, with at least one observed replica and the same template as baseline.
- `scope`: the preservation checker's source/target/container/image/revision
  bindings plus `environment: "production" | "staging"` and `rolloutOptIn: true`.
  Staging additionally requires `stagingRolloutOptIn: true`. Production remains
  pinned to `rg-kovagpt-prod/kovagpt-prod-web`; staging is pinned to the separate
  `rg-kovagpt-staging/ca-kovagpt-staging` app, never the Auth rehearsal app.
- `inventory`: `complete: true`, `apiVersion: "2025-01-01"`, UTC `observedAt`,
  collector `receiptSha256`, and `baselineSha256` / `previousRevisionSha256`.
  Document hashes use the exported `documentSha256` (recursively sorted JSON
  object keys, unchanged array order). The snapshot must be at most five minutes
  old and not expire before the planned start. Hash agreement proves binding,
  **not collector authenticity or live acceptance**; independent review remains.
- `canary`: UTC `windowStart` / `windowEnd` (future start, at most one hour total),
  integer `candidateWeight` / `maximumCandidateWeight` (1–99; requested weight
  cannot exceed the bound), and positive `maximumRecoveryMs` shorter than the
  window. The recovery reserve determines `rollbackMustStartBy`.
- Optional `desired`: independently prepared full document. If supplied, the
  existing checker must accept it without any extra property change.

The output contains five ordered, reviewable ARM group-deployment PUT requests,
exact target IDs and deterministic deployment names. Each request is Incremental,
targets only the existing app, uses the pinned 2025-01-01 Container Apps API, and
places all private values in a `secureObject` parameter. Parameter strings that
look like ARM expressions remain literal data. The planner never uses the
cost-frozen production bootstrap Bicep as the running app's desired state.

1. `prepare-multiple`: preserve the old template/image, enable Multiple mode and
   pin the named healthy previous revision at 100%. Verify completion before
   candidate creation, so Single mode cannot deactivate the rollback target.
2. `create-candidate-zero-traffic`: change only the primary image/suffix, retaining
   named previous=100. Candidate has no traffic allocation. This request does not
   reference a candidate revision before Azure has created it.
3. `pin-initial-traffic`: after candidate existence/digest/health verification,
   explicitly record named previous=100 / candidate=0.
4. `bounded-canary`: set named previous=(100−approved candidate weight) and the
   bounded candidate weight, only after separate Auth/database/origin/edge gates.
5. `rollback-traffic`: restore named previous=100 / candidate=0 without rewriting
   either revision's template, deleting data or changing Auth/schema. It can run
   after initial pinning even if the canary outcome is uncertain, but the actual
   current configuration and operation outcome must first be reconciled.

Requests carry a 60-second client limit, one attempt and zero retries. Those are
requirements for a future separately approved executor, **not an executor or a
server-side timeout/cost guarantee**. Revalidate complete property fingerprints
and both revision identities before each mutation; stop on concurrent changes,
stale observations or uncertain outcomes. Never replay an uncertain deployment.
Finish rollback and its verification inside the window. A candidate may still
cost money at 0% traffic; its subsequent deactivation/retention needs explicit
cleanup authority. Keep the previous healthy revision and both pinned images.

For staging, `infra/azure/staging/rollout.bicep` is an explicit opt-in alternative
to bootstrap: `enableRevisionRollout` defaults false. Its secure `rolloutResource`
parameter is the generated step's private resource body. It changes only the
existing staging app and creates no environment, registry, role or secret store.
Offline tests compile it and compare the emitted resource with the generator.
Unsupported staging root extensions fail closed rather than being dropped.
The original staging Single/latest=100 defaults and production Single/no-ingress
migration template remain unchanged.

Every writable setting is preserved, including unrecognized nested fields.
Only enumerated response metadata (resource identity envelope, system data,
revision/status/FQDN outputs and managed-identity principal/client IDs) is omitted
from the write body; assigned identity resource IDs remain unchanged. Unknown
root fields are rejected. This projection follows the pinned
[Container Apps resource contract](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-01-01/containerapps).

This closes the **source** gaps for M19's ordered two-revision canary/traffic
rollback, M22's opt-in staging rollout, and M23's configuration-preserving
zero-traffic production candidate preparation. It does not close any live gate.
Still required: exact accepted integrated source and image provenance; fresh
complete private captures and healthy previous evidence; independent property
review; Auth/database backward compatibility; candidate health/version and
protected-origin/edge/application checks; least-privilege execution authority;
proven zero incremental entitlement or a separately approved cost ceiling;
measured live rollback/recovery and independently verified cleanup. Final 100%
candidate promotion is not generated or authorized by this bounded canary plan.

1. Keep the previous healthy revision and digest available.
2. Deploy the candidate by immutable digest to a revision-specific endpoint.
3. Validate health and `/api/version` against that exact revision.
4. Promote traffic gradually or in a single reviewed switch.
5. On application failure, restore traffic to the previous revision/digest.
6. Verify homepage, auth, API health, streaming, and database compatibility after restoration.

## Secret-preserving request alternative (offline; not live approval)

The default full-resource generator still requires complete protected secret
material. An explicit alternative now uses Microsoft's documented
[2025-01-01 JSON Merge Patch operation](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps/update?view=rest-resource-manager-containerapps-2025-01-01):

```bash
node scripts/azure/revision-rollout-plan.mjs --secret-preserving-patch /private/input.json /private/plan.json
```

Both the existing rollout opt-in and `scope.secretPreservingPatchOptIn: true`
are required. Generation makes no cloud requests. Private input/output controls
are unchanged. This alternative never sends `configuration.secrets`, secret
values, registry settings, identities, origin controls or scaling. Existing
versionless Key Vault references remain versionless; it does not rotate, pin,
export or remove them. Microsoft's [secret rotation contract](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets#key-vault-secret-uri-and-secret-rotation)
still applies, so this is **not** proof of rollback to an earlier secret version.

Five ordered PATCH requests prepare Multiple mode with previous=100, create the
candidate at zero traffic, pin previous=100/candidate=0, apply bounded canary
weights, and restore previous=100/candidate=0. Only candidate creation transmits
the complete containers array, changing its reviewed image; traffic operations
send no template. Both request transports omit only the API's response-only
`ContainerResources.ephemeralStorage` field from transmitted container resources;
CPU, memory and unknown writable fields remain intact. An independent test model checks exact writable-document results
under [RFC7396](https://www.rfc-editor.org/rfc/rfc7396), including omitted fields,
atomic arrays and nulls. All healthy-previous, exact-template, freshness,
immutable-image, compatibility and approval requirements remain binding.

No live preservation or concurrency guarantee is claimed. Execution still needs
fresh preceding-state checks, an exclusive writer, post-write reconciliation,
bounded authorization and cost approval. Unknown outcomes must be reconciled,
never retried. The retained production capture remains blocked by its Activating
previous revision. The separate opt-in comparison below addresses the nine
response representation differences; it does not waive live health or freshness.

The public API bindings reviewed for this remedy are Microsoft's
`ContainerApps.json` blob `c1beb74e4ddf085861000eaf2e9c70537cdb9c87`
and `CommonDefinitions.json` blob `f848c0bae6efd28e8ffe3c57d3052838c00cc8ba`
under `specification/app/resource-manager/Microsoft.App/ContainerApps/stable/2025-01-01`
in `Azure/azure-rest-api-specs`. The latter also documents 300-second cooldown and
30-second polling defaults. The default comparison remains raw-exact.

### Explicit API-bound effective-template comparison

`scope.templateComparisonPolicy: "azure-containerapps-2025-01-01"` enables the
offline comparison in `revision-template-equivalence.mjs` only for captures
bound to that API version. It leaves both original documents and generated
writable configuration unchanged. Every field outside these narrow rules must
still compare exactly, including unknown fields, probes, sidecars, identities,
references, scaling rules and array order:

- Empty/null/absent suffix hints are equivalent only after the full revision
  name, resource ID and latest-ready identity bind the same revision. A nonempty
  conflicting suffix fails; the naming hint is not a substitute for identity.
- Empty/absent `value` is equivalent only on the same uniquely named environment
  entry with the same nonempty `secretRef`. Nonempty/null competing values,
  changed references and literal non-secret empty values are not normalized.
- A missing response-only `ephemeralStorage` can match an observed string; two
  conflicting observed capacities fail. CPU and memory are always exact.
- Unset cooldown/polling match only their documented 300/30-second defaults.

These rules apply the pinned public API definitions and Microsoft's
[environment-variable contract](https://learn.microsoft.com/en-us/azure/container-apps/environment-variables)
and [revision identity contract](https://learn.microsoft.com/en-us/azure/container-apps/revisions).
They establish effective writable-template equality, not secret-value/version
identity, current health, deployed compatibility or milestone acceptance. The
full generator still enforces original capture hashes, five-minute freshness,
stable Running/Healthy previous state, immutable images and exact desired-state
preservation. A plan must record its comparison policy and normalized paths for
independent release review; unknown policies fail closed.

## Database rollback

### Combined source integration: keep forward additions out of historical proof

The frozen Auth candidate (PR443 `e43686bc123f2e5efcd32a69e843f3fd4bf61b49`)
adds three migrations; Interface PR445 `54ae00a4ae37b1929fd25e610ad22ddef8bd99c0`
adds `20261008153032_launch_connector_runtime.sql`. Both preserve the exact first
185 source entries. They must be combined in timestamp order (189 entries), not
by choosing one manifest or rewriting the historical decision to 210 entries.

`canonical-history-decision.mjs` accepts only the existing exact Auth/Interface
manifest hashes or the reviewed combined manifest hash
`f433e696e75e46f942fe09eb8cdb06e4e20701cd7c550b00aa39d225bfec1d5e`.
Its historical result remains byte-semantically unchanged: 98 remote entries,
185 source entries, 111 pending historical versions, 107 conditional bodies,
four conditional record-only versions and a hypothetical 209-entry endpoint.
The four new versions are hash-checked and deferred; the Auth trio is all-or-none.
No historical decision, lineage, actual migration manifest or database has been
rewritten by this source correction. The fixture manifest records exact public
SQL/source bindings; those copies are test inputs, not installed migrations.

When forming the final integrated source, retain these Azure history guards and
all current historical tests, use the ordered union manifest above, and keep
the new migrations in the separate forward phase. The AuthDialog three-way
combination is text-clean but still needs Auth/Interface behavior acceptance;
the database contract matches the frozen Auth candidate. Text compatibility and
mocked source tests do not supply the missing 19 historical proofs or authorize
applying any forward migration. Auth's live deletion/revocation and shared-plan
entitlement requirements remain binding; family creation/invitations remain
outside reduced launch.

Database migrations are treated as forward-only unless an explicit tested down path exists. Use expand/contract changes so the previous application remains compatible during the rollback window. For destructive or incompatible migrations, restore from the recorded backup/PITR point only under a separate incident decision; never improvise a reverse SQL script in production.

## Auth migration rollback

Auth migration is exactly once. Before starting, export source counts and identity mappings and record destination emptiness. If migration fails before cutover, keep source auth authoritative and remove only rehearsal/destination records created by the failed run under an audited procedure. If cutover has occurred, do not rerun blindly; use the recorded mapping and incident plan.

## Cloudflare rollback

Preserve the prior DNS/origin values and TTL state. Do not change Cloudflare until the Azure candidate is healthy. If edge routing fails after cutover, restore the recorded prior origin or bypass rule, then verify TLS, redirects, static assets, APIs, auth callbacks, streaming, and uploads.

## Proof standard

A written plan is not rollback proof. Final release requires a controlled exercise that restores the previous Azure revision without data loss and records timestamps, commands, digests, health responses, and observed recovery time.

The previously recovery-local evidence checker is now included in this source
candidate as `scripts/release/azure-rollback-exercise.mjs`. It verifies the existing
M19 receipt contract, including nonzero-to-zero traffic, bound digests, timing,
protected-origin and Auth/database checks, explicit scope and $0 ceiling. Its
resource grammar accepts Azure's canonical `containerApps` spelling while target
equality remains exact. Run it only on separately obtained evidence:

```bash
node scripts/release/azure-rollback-exercise.mjs /private/path/exercise.json /private/path/approved-scope.json
```

Synthetic unit fixtures are not live M19 evidence. Neither checker authorizes an
operation or independently establishes collector authenticity or acceptance.
