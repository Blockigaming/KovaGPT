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
