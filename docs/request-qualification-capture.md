# Private request capture, without generation

This tooling is default-off preparation. It does not authorize a build, start,
deployment, provider generation, credential creation or a change to Azure.
Terminal owns shared Azure inventory and existing credential custody. Preserve
PR #458 and PR #459; their previous checks do not certify this new delta or a
running deployment. Do not use the separate Auth allowance.

The capture path runs through the existing `/api/chat` request parser, real
session validation, moderation/entitlement reads and owner-scoped context
assembly. It requires an already persisted, owned, non-temporary chat. It uses
the actual Responses conversion and final model mapping, then the acceptance
operation's 64-output-token clamp. It returns before connector planning, usage
reservation, acceptance-slot claims, provider credentials/HTTP or metering.
The daily chat quota is skipped only for an admitted capture. Guests and
unsupported inputs fail before quotas. With capture enabled, the final provider
seam and the separate speech route deny execution, including misconfiguration.

Only the fixed instant-mode, single-user-message operation is supported:
`Reply exactly: Kova speech test.` No previous messages, attachments, project,
tool, custom Kova, workflow skill, Temporary Chat or summary proof is accepted.
The real composer's first-turn `historyOffset:0` and `memoryStartIndex:0` are
accepted; positive boundaries are denied. Actual account preferences,
personality, eligible cross-chat memory and existing chat workspace context are
assembled as for the normal route. Capture is not a general transcript export.

## Private inputs

Use an already authorized Linux/Node 24 server context containing this exact
reviewed source and its matching compiled `BUILD_IDENTITY.sha`. These commands
are ready for that context; do not build, deploy or activate one merely to run
them. Linux `/proc/self/fd` must be available. Generation/deployment remain
pending qualified combined cost and independent shutdown bounds.

Keep the following outside Git, build contexts, served/static roots and public
artifacts. Directories must already exist, belong to the process user and have
mode `0700`; private files must have mode `0600`. Do not paste credentials into
commands or chat, enable shell tracing, or use verbose HTTP logging.

1. `/absolute/private/capture-plan.json`: the exact plan below with real values.
2. `/absolute/private/chat-request.json`: the intended actual account's composer
   request body, including its actual profile/personality, timezone and locale;
   fixed prompt, `mode:"instant"`, the plan's chat ID and first-turn boundaries.
   Do not substitute a synthetic profile and call it account evidence.
3. `/absolute/private/session.headers`: current existing authentication headers
   for only the exact approved origin, with `X-Kova-Owner` matching the plan.
   Supabase uses its existing bearer session; Kova uses its existing cookie
   session and matching trust. No new Auth signing/encryption/email work is
   required for the existing Supabase path.
4. Existing server backend URL, publishable/service-role bindings and working
   session/history/context contracts. Capture itself needs no provider API key.
5. An owner-only capture directory outside the server working directory and all
   served roots, plus the independently verified exact HTTPS capture origin.

The capture plan schema is:

```json
{
  "version": 1,
  "operationId": "ORIGINAL-OPERATION-UUID",
  "ownerId": "ACTUAL-AUTHENTICATED-OWNER-UUID",
  "chatId": "EXISTING-OWNED-CHAT-UUID",
  "source": { "commit": "EXACT-40-CHARACTER-SHA", "tree": "EXACT-40-CHARACTER-TREE" },
  "authMode": "supabase",
  "evidenceKind": "actual-account-request-capture",
  "notBefore": "CANONICAL-ISO-UTC-START",
  "expiresAt": "CANONICAL-ISO-UTC-EXPIRY"
}
```

The placeholders deliberately fail. The active window is at most ten minutes.
Use `synthetic-fixture` for mocked inputs and keep its evidence separate.
Source must match the actual compiled SHA and pinned `KOVA_SOURCE_TREE`.
An operator-set source/tree or evidence-kind label is not independently
authenticated provenance; original source, runtime and account evidence still
require review.

## Ready commands, after runtime and private inputs qualify

Set these nonsecret, server-only bindings in the already authorized private
execution context. This is not a command to save an Azure revision:

```sh
export AZURE_ENVIRONMENT=staging
export KOVA_DEPLOYMENT_TARGET=ca-kovagpt-staging
export KOVA_AUTH_MODE=supabase
export KOVA_TEXT_PROVIDER=openai
export KOVA_GENERATION_DISABLED=true
export AI_GENERATION_ENABLED=false
export KOVA_SPEECH_ENABLED=false
export KOVA_GENERATION_ACCEPTANCE_ENABLED=false
export KOVA_REQUEST_CAPTURE_ENABLED=true
export KOVA_REQUEST_CAPTURE_DIRECTORY=/absolute/private/captures
export KOVA_REQUEST_CAPTURE_PLAN="$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(fs.readFileSync(process.argv[1],"utf8").trim())' /absolute/private/capture-plan.json)"
export KOVA_REQUEST_CAPTURE_PLAN_SHA256="$(node --input-type=module -e 'import fs from "node:fs"; import {acceptanceDigest} from "./src/lib/generation-acceptance.server.mjs"; process.stdout.write(acceptanceDigest(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))))' /absolute/private/capture-plan.json)"
export KOVA_SOURCE_TREE="$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).source.tree)' /absolute/private/capture-plan.json)"
```

The compiled build SHA is checked separately; setting an environment SHA does
not replace it. On an enabled capture host, ordinary `/api/chat` requests without
the exact operation header are denied. Keep other workers/dispatchers off.

Use the exact existing approved HTTPS origin, never an arbitrary URL. The
following performs one bounded capture request, follows no redirects, places
credentials only in a private headers file, and writes only a redacted receipt:

```sh
umask 077
CAPTURE_ORIGIN='https://EXACT-APPROVED-STAGING-ORIGIN'
CAPTURE_OPERATION="$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).operationId)' /absolute/private/capture-plan.json)"
curl --silent --show-error --fail --proto '=https' \
  --connect-timeout 5 --max-time 30 --max-redirs 0 --max-filesize 4096 \
  --request POST --header @/absolute/private/session.headers \
  --header 'Content-Type: application/json' \
  --header "x-kova-request-capture: $CAPTURE_OPERATION" \
  --data-binary @/absolute/private/chat-request.json \
  --output /absolute/private/capture-http-receipt.json \
  "$CAPTURE_ORIGIN/api/chat"
```

Review HTTP status `201` and `REQUEST_CAPTURED_NO_GENERATION`. The complete
constructed body is written only on the server as
`<capture-directory>/<operationId>.json`, mode `0600`. The response and logs do
not contain its instructions/account content, authentication headers, API keys
or filesystem path. The directory is inode-verified and held open; exclusive
descriptor-anchored creation prevents overwrite, symlink redirection and
operation replay. Failed/partial artifacts are not a successful capture receipt;
preserve them for review rather than deleting them to retry.

The route makes no application data writes. A normal composer interaction may
separately auto-save client conversation history; that is not covered by the
route's zero-write result. Use an already persisted owned chat and a reviewed
private request transport to avoid racing chat creation or making an unrelated
client-side history change. Do not call ordinary live `/api/chat` to obtain a
payload, and do not use a fixture's system prompt as the actual account payload.

For exact counting use [request-qualification-count.md](request-qualification-count.md).
Keep the count plan's window covering this capture and bind its hashes and
evidence kind. Every date, locale, profile, context, model, configuration or
instruction change requires a new reviewed capture/count binding before any
generation. There is no automatic recapture or count retry.

## ElevenLabs remains a separate API qualification

Retain ElevenLabs for voice. The Free-plan balance display is not API access,
key permission, voice/model entitlement, a multiplier or an overage-price proof.
After Terminal establishes existing custody, the metadata-only helper in
[provider-metadata-preflight.md](provider-metadata-preflight.md) can make its
four explicitly authorized GET attempts with existing keys. The intended
workspace/key metadata must separately establish enabled `text_to_speech`
permission and access to the selected voice/model/output format. Metadata
inspection needs `voices_read`, `models_read`, `user_read`; a separate read key
does not prove the runtime TTS key's permission. Review actual API tier, usage,
limit/overage and any voice multiplier. No real entitlement check has run in
this implementation. Do not create a key because an app secret slot is absent.

The existing candidate voice is George, `JBFqnCBsd6RMkjVDRZzb`, with
`eleven_multilingual_v2` and `mp3_44100_128`. Those protocol identifiers do not
prove that the intended workspace/key may use that combination. Terminal must
identify existing custody first; then privately bind the actual key permission,
voice/model metadata and API subscription/overage evidence. The Free-plan
dashboard's credit number is not that evidence.

Even a successful metadata check and exact input count do not authorize text or
speech generation. The combined cost/shutdown approval, immutable image and
serving revision, owned durable message, live streamed completion, real playback
and Stop acceptance remain separate and outstanding.
