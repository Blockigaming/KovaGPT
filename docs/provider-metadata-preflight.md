# Metadata-only provider preflight

`scripts/azure/provider-metadata-preflight.mjs` fills a preparation gap between
the existing offline generation-evidence validator and private provider checks.
It reuses existing credentials and never creates, changes, lists or reveals API
keys. The default invocation makes no requests and does not read credentials:

```sh
node scripts/azure/provider-metadata-preflight.mjs
```

An independently authorized operator can inspect metadata explicitly:

```sh
node scripts/azure/provider-metadata-preflight.mjs --inspect-metadata
```

Before that invocation, the existing private execution context must supply
`KOVA_PROVIDER_METADATA_INSPECTION_ENABLED=true`, `AZURE_ENVIRONMENT=staging`,
`KOVA_DEPLOYMENT_TARGET=ca-kovagpt-staging`, the existing `OPENAI_API_KEY` and
`ELEVENLABS_API_KEY`, and the selected existing `ELEVENLABS_VOICE_ID`. Do not put
credential assignments in command history, source, screenshots or chat. No
credential is copied from Azure or a password manager by this helper. A separate
metadata credential can be used for ElevenLabs Voices/Models/User read access;
successful inspection then says nothing about the runtime TTS key's permission.

The implementation has no configurable provider URL. It performs exactly one
GET against each official endpoint, with no retries or generation:

| Endpoint                                  | What a successful metadata match establishes                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| OpenAI `/v1/models/gpt-5.6-luna`          | The credential can retrieve that model's metadata.                                     |
| ElevenLabs `/v1/voices/{selectedVoiceId}` | The credential can retrieve the selected voice's metadata.                             |
| ElevenLabs `/v1/models`                   | The requested `eleven_multilingual_v2` model is listed as TTS capable.                 |
| ElevenLabs `/v1/user/subscription`        | Subscription status, positive credit headroom and overage-mode fields can be observed. |

Every request rejects redirects, limits response bytes, and has an eight-second
deadline within a 35-second inspection deadline. Output contains bounded status
fields and evidence hashes, without raw response bodies, voice/account names,
recipient identifiers, invoice details, API keys, or provider exception text.
The selected voice is bound by SHA-256 rather than copied into the report.
Output is private operational evidence; do not commit actual account reports.

## What remains required

This is metadata inspection, **not live acceptance or a spending approval**.
Model metadata does not prove permission to generate through Responses. Voice
metadata and a TTS-capable model listing do not prove the runtime key's Text to
Speech permission, exact account entitlement, an available voice/model pairing,
or successful audio playback. Positive headroom does not establish that the
120-character request fits its account-specific credit multiplier. An overage
setting does not establish a dollar cap.

The existing qualification still needs the real account's exact final request
body and exact token count, account-specific provider rates, Azure build/runtime
costs and cancellation bounds, independent shutdown control, immutable image and
serving-revision evidence, and the separate consolidated authorization. The
existing Auth-only allowance is not a Models allowance. The collector does not
start staging, resolve secrets, call token-count/generation endpoints, submit a
build, inspect Azure, or claim a limiter slot.

The script uses Node and has no Mac-specific paths. An already authorized
browser-hosted shell or reviewed server context can run it after its runtime and
private credential handoff are verified. Shell availability does not qualify
durable shutdown; closing a browser is not a stop executor.

Official protocol references:

- https://developers.openai.com/api/reference/resources/models/methods/retrieve
- https://elevenlabs.io/docs/api-reference/voices/get
- https://elevenlabs.io/docs/api-reference/models/list
- https://elevenlabs.io/docs/api-reference/user/subscription/get
