# KovaGPT production rollback plan

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

## Database rollback

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
