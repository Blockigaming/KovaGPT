# Bounded API / Read aloud acceptance

This extends staging candidate `3784f594...` without replacing its repaired
provider adapter, authentication interface, speech feature or explicit Retry.
It does not authorize deployment, generation, account reads, purchases or secret
changes. The Auth-only build/run allowance remains separate and generation off.

## Operation limits

When `KOVA_GENERATION_ACCEPTANCE_ENABLED=true`, the final provider admission
fence permits only the reviewed operation. It denies other application,
developer, helper, image, embedding and tool-generation calls at the same
provider seam. Ordinary behavior is preserved while this flag is absent/false.

- One OpenAI Responses generation, model `gpt-5.6-luna`, standard service tier,
  streaming, no storage, tools, media or prior response/conversation IDs.
- Fixed user prompt: `Reply exactly: Kova speech test.`
- The complete final serialized provider body, including system instructions,
  is pinned by a canonical SHA256. A count of that exact input, verified with
  the actual model, must be bound as evidence. Input is at most 32,768 UTF-8
  bytes and 8,192 verified tokens. The ordinary bytes/3 usage estimator is not
  accepted as a token-count proof.
- Provider output is clamped to 64 tokens, including non-visible model tokens.
- One ElevenLabs streaming request, `eleven_multilingual_v2`, the exact existing
  account-accessible voice in the reviewed plan, and at most 120 printable ASCII
  characters from a saved, owner-authorized completed assistant message.
  The original server-side message ownership and principal checks remain intact.
- At most 180 seconds in one fixed UTC hour, ending at least 30 seconds before
  its boundary. Each provider atomically reserves a separate limit-one bucket
  through the existing distributed limiter. Deadline, hash and scope are checked
  again after the reservation. Failure, Stop, timeout and unknown outcomes never
  refund the slot. Replica/process restart does not reset it during validity.
- Server request deadlines are shortened to the operation expiry. Stop still
  aborts downstream requests and playback. There are zero automatic retries.

## Private configuration and external facts

No new signing keys or Auth secrets are required. The operation uses existing
server credential custody and the existing limiter's hash secret. Do not alter
the staging Auth signing/encryption/email secrets being prepared elsewhere.

Server-only runtime bindings are:

- `KOVA_GENERATION_ACCEPTANCE_ENABLED=true`.
- `KOVA_GENERATION_ACCEPTANCE_PLAN`: the reviewed `AcceptancePlan` JSON from
  `src/lib/generation-acceptance.server.d.mts`.
- `KOVA_GENERATION_ACCEPTANCE_PLAN_SHA256`: independently bound canonical plan hash.
- `KOVA_GENERATION_ACCEPTANCE_APPROVAL`: actual approval receipt JSON.
- `KOVA_GENERATION_ACCEPTANCE_APPROVAL_SHA256`: independently bound receipt hash.
- `AZURE_ENVIRONMENT=staging`, `KOVA_DEPLOYMENT_TARGET=ca-kovagpt-staging`,
  exact `KOVA_SOURCE_TREE`, `KOVA_IMAGE_DIGEST`, and the actual
  `CONTAINER_APP_REVISION` binding. The compiled build SHA must match the plan.

The selected model/voice, ordinary private API-key references, speech enablement,
browser/server Auth mode and backend limiter configuration must also qualify.
No credential or concrete plan/receipt value belongs in browser source or Git.

Quote values use integer nanoUSD, with conservative upward division. The guard
reserves the upper bound for the verified full input, all 64 output tokens and
all 120 speech characters before either generation. Rates must cover the
applicable account/model/voice, cache-write premiums, fees/taxes or any other
applicable charge; a base model price alone is insufficient. A missing, expired,
inconsistent or unbound quote/approval denies all guarded calls. Evidence hashes
and valid JSON do not independently authenticate a price or create authorization.

Public references (not proof of this account's price or access):

- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/guides/token-counting
- https://elevenlabs.io/docs/api-reference/user/subscription/get
- https://elevenlabs.io/docs/api-reference/voices/get
- https://help.elevenlabs.io/hc/en-us/articles/26050485079057-What-are-custom-rates-and-credit-multipliers

## Qualification and execution order

1. Qualify the exact source and CI, then build an immutable image with the
   correct browser Auth mode, project/origin configuration and existing browser
   provenance verification. A local Node package is not a registry image.
2. Bind registry manifest digest, image source/tree labels, compiled browser
   provenance, exact staging app, one healthy serving revision, 100% traffic,
   and an observed `/api/version` response from that origin. Do not reuse an old
   image or substitute an image config digest for its registry manifest digest.
3. Securely verify existing OpenAI access and ElevenLabs key/voice entitlement,
   credit/overage state and account-specific upper rates. Obtain the exact final
   input token count without generating output, only with applicable read
   authority. No account metadata/count request is made by these modules.
4. Prepare one reviewable plan and actual bounded approval. Keep the Auth-only
   run generation-disabled; do this only after its owner confirms it has stopped
   and the separate generation/deployment authority applies. Never share its
   budget or restart its app as an unapproved workaround.
5. `scripts/azure/qualify-generation-staging.mjs` checks supplied private evidence
   offline. It reuses existing image/revision validators and validates the actual
   runtime plan/receipt without claiming a slot. It makes no cloud calls and
   grants no execution authority. Original evidence/approval still need review.
6. The bounded browser executor must inject the nonsecret
   `x-kova-acceptance-operation` header only on same-origin `/api/chat` and
   `/api/speech` requests from its isolated authenticated context. The actual
   composer, response rendering, Read aloud and Stop controls remain in use.
   Ordinary UI requests without this header fail closed in guarded mode.
7. Confirm visible streamed completion and idle composer, then durable saved
   message synchronization. If the full response exceeds 120 characters, stop;
   do not truncate or generate another response. Click Read aloud once, observe
   actual playback, then Stop and confirm request/playback cancellation.
8. On any failure/unknown result, stop without retry. Disable generation/speech,
   abort pending work and stop staging under the applicable approval; verify
   stopped. Preserve receipts. Delete only scoped acceptance fixtures when
   authorized; no historical or unrelated account data may be removed.

No live maximum USD amount, account voice, image digest, running revision or
approval receipt is supplied by this source. Until those external facts are
available, the operation is prepared but cannot execute.
