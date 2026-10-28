# OpenAI and ElevenLabs release bindings

Source baseline: unpublished tree `0d7522a2b4528483e1f856c2022253424e047c71`.
Monitoring owns private operator access, runtime configuration, image builds,
deployment and rollback. These are source contracts, not observations of the
deployed app or proof that an account can generate.

## Current production gap

The owner's last observation of `kovagpt-prod-web` found an existing
`openai-api-key` secret reference without an `OPENAI_API_KEY` environment
binding. ElevenLabs had no secret slot or voice bindings in that observation.
Reuse the existing privately held provider keys. No replacement key, GPU,
provider change, or production operation is part of this source delta.

The existing production Bicep already supports the required secret references
and environment bindings. Applying its whole template is not necessary to fix
one missing binding; Monitoring must preserve unrelated live configuration.

| Runtime binding                  | Existing production Bicep parameter | Required value or evidence                                                                                                               |
| -------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                 | `openAiApiKeySecretUri`             | Environment `secretRef: openai-api-key`, referencing the existing private key; never a raw environment value                             |
| `KOVA_TEXT_PROVIDER`             | `textProvider`                      | `openai`, so text does not follow the still-configured Azure endpoint                                                                    |
| `KOVA_INSTANT_MODEL`             | fixed in template                   | `gpt-5.6-luna`, access unverified                                                                                                        |
| `KOVA_NORMAL_MODEL`              | fixed in template                   | `gpt-5.6-luna`, access unverified                                                                                                        |
| `KOVA_THINKING_MODEL`            | fixed in template                   | `gpt-5.6-terra`, access unverified                                                                                                       |
| `KOVA_DEEP_MODEL`                | fixed in template                   | `gpt-5.6-sol`, access unverified                                                                                                         |
| `KOVA_UTILITY_MODEL`             | fixed in template                   | `gpt-5.6-luna`, access unverified                                                                                                        |
| `ELEVENLABS_API_KEY`             | `elevenLabsApiKeySecretUri`         | Environment `secretRef: elevenlabs-api-key`, using the owner's existing private key                                                      |
| `ELEVENLABS_VOICE_ID`            | `elevenLabsVoiceId`                 | An actually accessible provider voice ID for the legacy single-voice configuration; currently unresolved                                 |
| `KOVA_VOICE_CATALOG`             | `voiceCatalog`                      | Optional server JSON catalog; omit for legacy single-voice mode; every configured provider voice/model and allowed plan must be reviewed |
| `KOVA_VOICE_DEFAULT_ID`          | `voiceDefaultId`                    | Optional opaque catalog ID, present in that explicit catalog                                                                             |
| `KOVA_VOICE_ENABLED`             | `voiceEnabled`                      | `true` to admit `/api/voice`; default remains off                                                                                        |
| `KOVA_VOICE_AUDIO_ENABLED`       | `voiceAudioEnabled`                 | `true` for Dictate and recorded voice-turn transcription; default remains off                                                            |
| `KOVA_VOICE_DAILY_REQUEST_LIMIT` | `voiceDailyRequestLimit`            | Owner-selected positive safe integer; zero leaves `/api/voice` unavailable                                                               |
| `KOVA_SPEECH_ENABLED`            | `speechEnabled`                     | `true` for saved-response Read aloud and spoken conversation replies; independent of the other voice gates                               |
| `KOVA_VOICE_OPENAI_MODELS_JSON`  | `voiceOpenAiModelIds`               | Explicit exact OpenAI text model IDs eligible for ElevenLabs output; empty disables output                                               |
| `KOVA_VOICE_MODEL_PROOF_SECRET`  | `voiceModelProofSecretUri`          | Versioned Key Vault URI for the independent model receipt signing key; missing leaves output disabled                                    |
| `KOVA_GENERATION_DISABLED`       | `generationEnabled` (inverted)      | `false` only at Monitoring's authorized runtime activation; `true` blocks generation and speech                                          |

`generationEnabled` also emits `AI_GENERATION_ENABLED`; set it consistently to
`true` for activation and `false` for preparation. Startup validation reads that
setting, while the source runtime's emergency gate is `KOVA_GENERATION_DISABLED`.
Do not rely on changing `AI_GENERATION_ENABLED` alone. Existing backend authentication, billing/quota
RPCs, durable history, distributed rate limiter and `KOVA_IP_HASH_SECRET` remain
required. `/api/voice` additionally requires an explicitly enabled database
`feature_flags` row named `voice`, verified email, a non-banned account and a
matching captured-owner header. Leave request-capture and generation-acceptance
modes absent or `false` for normal voice use: `/api/voice` deliberately refuses
those special operator modes.

If `KOVA_AI_CAPABILITIES` is customized, it must still permit `chat` and
`streaming`. `KOVA_AI_TIMEOUT_MS` defaults to 45 seconds and is clamped to
5–120 seconds. Direct text requests use Responses with `store=false` and
`service_tier=default`; history durability comes from Kova's existing writer,
not provider response storage. Legacy `KOVA_CHAT_MODEL`/`KOVA_FAST_MODEL` samples
do not drive the active role/catalog path described below.

Keep every existing Azure image/embedding endpoint, deployment, authentication
and managed-identity binding unchanged. `KOVA_TEXT_PROVIDER=openai` applies only
to text capabilities in the current adapter.

The `KOVA_*_MODEL` rows above are catalog policy slots and output constraints.
Active chat and utility selection also uses the existing role router below.
The production template leaves these role overrides unset; their source defaults
match the same three text models. Monitoring must inspect both sets before
cutover, rather than changing only a catalog slot and assuming it changes routing.

| Active role override            | Source default  | Used for                                              |
| ------------------------------- | --------------- | ----------------------------------------------------- |
| `KOVA_MODEL_DEFAULT_CHAT`       | `gpt-5.6-luna`  | Basic chat                                            |
| `KOVA_MODEL_ADVANCED_REASONING` | `gpt-5.6-terra` | Thinking and eligible complex requests                |
| `KOVA_MODEL_PREMIUM_REASONING`  | `gpt-5.6-sol`   | Explicit premium reasoning under existing entitlement |
| `KOVA_MODEL_UTILITY`            | `gpt-5.6-luna`  | Titles and other utility roles                        |
| `KOVA_MODEL_IMAGE_ANALYSIS`     | `gpt-5.6-luna`  | Image understanding through the text API              |

Explicit malformed text-role overrides now fail closed; valid IDs still need
catalog authorization and actual provider access. The existing role routing and
plan decisions remain unchanged. Leave `KOVA_MODEL_IMAGE_GENERATION`,
`KOVA_MODEL_EMBEDDING` and all Azure capability configuration unchanged.

## Exact route and model contracts

| User action                   | Implemented path                                                                                                           | Provider endpoint and model                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Text reply                    | Existing chat submission and streaming renderer                                                                            | OpenAI `POST /v1/responses`; policy mapping above                            |
| Dictate                       | Explicit microphone Start, bounded recording, local PCM normalization, `/api/voice` STT, transcript review, Use transcript | ElevenLabs `POST /v1/speech-to-text`, multipart `file`, `model_id=scribe_v2` |
| Voice conversation            | Same STT, existing chat submission, exact saved-history acknowledgment, `/api/speech`, actual playback completion          | STT above, OpenAI chat above, then saved-message ElevenLabs speech below     |
| Read aloud / Stop             | Saved assistant message IDs and content hash, `/api/speech`, shared playback manager                                       | ElevenLabs `POST /v1/text-to-speech/{voice_id}/stream`, `mp3_44100_128`      |
| Existing voice-dialog preview | `/api/voice` TTS with opaque catalog ID                                                                                    | ElevenLabs `POST /v1/text-to-speech/{voice_id}`, `mp3_44100_128`             |

Saved speech now accepts optional opaque `voiceId`; server-side catalog and
effective account plan choose the actual provider voice and model. Explicit
unknown or locked selections fail before provider access. No client model,
provider voice ID or text override is accepted by `/api/speech`. Without a
catalog, the existing single voice and `eleven_multilingual_v2` behavior remain.
With a catalog, both spoken conversation replies and Read aloud resolve the
authorized catalog selection/default. Configured catalog models are limited to
`eleven_flash_v2_5`, `eleven_multilingual_v2`, and `eleven_v4`; this allowlist is
source support, not account entitlement. Do not select an unqualified entry or
silently substitute a different model after a provider rejection.

For the first qualified single-voice setup, `scribe_v2` transcription and
`eleven_multilingual_v2` speech match the implemented REST paths. The existing
metadata preflight covers only Multilingual-v2 speech metadata, with no STT
permission or model check. No actual voice ID or accessible model is established yet.
The optional Flash/v4 entries need their own selected-model and endpoint
qualification; the current preflight checks only Multilingual v2.

`GET /api/voice` now reports `conversation` separately from `stt` and `tts`.
It requires configured transcription, an eligible output voice and the separate
saved-speech activation gate. Voice Start/retry requires that capability plus an
available selected catalog entry. Dictate remains usable when STT is available
but spoken conversation is not. These are configuration checks, not claims that
the provider has accepted a real request.

Preserved limits: local recordings 8 MiB and at most 60 seconds; server input
canonical mono PCM16 WAV at 16 kHz, 0.1–60 seconds; `/api/voice` 5,000 text units,
16 MiB output and 45-second provider bound; `/api/speech` 4,000 text units,
8 MiB output and 60-second deadline. A voice conversation uses one daily STT
unit plus normal chat allowance plus the separate saved-speech rate limits.
`/api/voice` TTS previews consume another daily voice unit. These are request
limits, not provider currency budgets. Stop cannot undo charges already incurred.

## Account requirements and evidence limits

OpenAI needs the existing key's project to permit Responses generation with
each exact selected model, available API billing/quota and sufficient rate
limits. Official model pages document Responses and streaming for Luna, Terra
and Sol; that does not establish this project's access. The model pages list
the free API tier as unsupported. A ChatGPT plan is not evidence of API access.

ElevenLabs needs the existing key's speech-to-text and text-to-speech scopes,
available quota/credits, selected model access and permission to use the chosen
voice through the API. A voice metadata response is insufficient proof of
generation, model/voice compatibility or commercial-use rights. No exact paid
account tier or selected voice can be asserted from this handoff. Provider
subscription/voice licensing and API permission checks belong to Monitoring's
private operator session. The implementation uses MP3 44.1 kHz/128 kbps; it does
not require the separately restricted 192 kbps MP3 or raw 44.1 kHz PCM formats.
No zero-retention mode is requested or promised.

Official references inspected 2026-10-21:

- [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
  [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
  [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
- [Create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
  [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
  [Stream speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream),
  [model overview](https://elevenlabs.io/docs/overview/intro).

## Monitoring execution checklist

1. Integrate this patch against the exact shared baseline; resolve overlaps with
   Interface around the voice dialog and playback, and with Auth around the
   speech route's existing verified principal. Preserve later owner changes.
2. Reuse the recovered OpenAI-only metadata operator and provider model/voice v2
   preflight. Both are preparation with mocked evidence. Metadata is not a live
   generation result. The separately reviewed default-off GitHub metadata
   workflow source/review packet was not in the shared source or recovered
   operator packages; obtain that exact dependency before publishing/executing it.
3. In private operator access, verify existing secret resolution and bind
   `OPENAI_API_KEY` to `openai-api-key`. Select text provider explicitly and
   verify access to all configured text model IDs. Do not replace Azure image
   or embedding settings. Record only sanitized configuration receipts.
4. Bind the already-held ElevenLabs key to the new server secret reference,
   establish the accessible voice, STT/TTS permissions and quota, select the
   legacy voice or reviewed catalog, and choose the daily request cap. Confirm
   both voice and speech gates plus the database voice feature flag.
5. Build and deploy the reconciled candidate through Monitoring's existing
   release process. Do not represent this local patch/build as deployed.
6. Observe real streamed OpenAI output, Stop, and reload of the same conversation.
   Then observe Dictate into the composer, a voice turn with an acknowledged
   saved reply, actual audio playback, Read aloud and Stop. Verify selected
   catalog voice is sent as an opaque ID and resolved to the intended provider
   voice/model. Record results separately from local fixtures; failed provider
   permission/model/voice checks stay failed, without fallback or automatic retry.

All seven live done criteria are **unperformed** in this source workstream:
OpenAI streaming, Stop, conversation reload, Dictate transcription, saved real
voice reply, ElevenLabs playback, and Read aloud/Stop.
