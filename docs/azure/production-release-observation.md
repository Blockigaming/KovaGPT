# Observe the exact production release

The read-only observer joins the approved Azure revision and immutable image to
the build actually returned by the public site. It never deploys, stops the app,
changes scale or traffic, reads secrets, calls a provider or sends notifications.
Importing the module and running its tests make no network requests.

After the separately approved release has completed, the existing authenticated
Azure operator supplies a private plan with the exact approved values:

```json
{
  "version": 1,
  "observationId": "NEW-OBSERVATION-UUID",
  "subscriptionId": "APPROVED-SUBSCRIPTION-UUID",
  "resourceGroup": "APPROVED-EXISTING-RESOURCE-GROUP",
  "appName": "APPROVED-EXISTING-APP",
  "containerName": "APPROVED-CONTAINER",
  "revisionName": "APPROVED-EXACT-REVISION",
  "sourceSha": "APPROVED-40-CHARACTER-SOURCE-COMMIT",
  "image": "APPROVED-REGISTRY.azurecr.io/APPROVED-REPOSITORY@sha256:APPROVED-64-CHARACTER-DIGEST",
  "origin": "https://APPROVED-PUBLIC-HOSTNAME",
  "createdAt": "CURRENT-CANONICAL-UTC-TIMESTAMP",
  "expiresAt": "CANONICAL-UTC-TIMESTAMP-NO-MORE-THAN-TEN-MINUTES-LATER"
}
```

These placeholders are deliberately invalid. Do not include passwords, tokens,
readiness credentials, account content or secret values. Build with
`KOVA_BUILD_SHA` set to the exact approved source commit; a build stamped
`unknown` cannot pass this observation. The complete build/browser/input and
image provenance requirements remain applicable.

The operator can then run, preserving stdout as private release evidence:

```sh
node scripts/azure/production-release-observation.mjs --observe /absolute/private/release-observation-plan.json
```

The whole attempt has at most 60 seconds, further narrowed by the plan's original
expiry. It issues at most three projected Azure read commands, each with at most
20 seconds, and two public GETs, each with at most eight seconds. There are no
script-level retries. Azure CLI transport behavior remains that of the installed
CLI. Public GETs omit credentials, refuse redirects and accept at most 64 KiB of
JSON from the fixed `/api/health` and `/api/version` paths.

`RELEASE_OBSERVED` requires all of the following:

- The exact app is Running, in Single revision mode, with the approved revision
  both latest and latest-ready and receiving 100% of traffic.
- That exact revision is active, Healthy and Running. Its named container uses
  the approved immutable digest reference.
- Public health responds successfully with the approved source build.
- Public version's JSON and `X-Kova-Build` header match that same source build.
- Both public responses declare `no-store`; a fresh projected app read after
  them still shows the approved revision and traffic.

Any failed or unfinished check yields `RELEASE_UNVERIFIED` and a nonzero exit
status. Responses and raw CLI diagnostics never enter the receipt. Preserve the
receipt privately: target IDs, registry identities and release configuration are
operator evidence, not content to publish in the source repository.

This proves one bounded observation. It is not continuous monitoring, a future
uptime guarantee, billing authorization, independent shutdown evidence, or proof
that authentication, text generation or speech works. Those two receipt fields
are always false: `liveAuthVerified` and `providerGenerationVerified`. Actual
owner login/token acceptance, a successful authorized text request with saved
history, and successful authorized ElevenLabs playback/Stop require their own
real acceptance evidence. The observer leaves production running.

The existing readiness response also needs careful interpretation: structural
email readiness checks credential presence, and structural runner readiness
checks database configuration. Neither establishes successful queue dispatch,
provider delivery, an available executor or a signed runner heartbeat. A schema
health pass must not substitute for these acceptance results.

The existing staging shutdown helper remains staging-only. Its local timer and
mocked checks do not qualify an independent controller. It is not a prerequisite
for ordinary production observation and must never be redirected to production.

Offline validation:

```sh
node --test tests/unit/production-release-observation.test.mjs
```
