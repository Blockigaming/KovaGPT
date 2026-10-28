# ElevenLabs voice boundary

This local implementation is unconfigured by default. No live provider request, secret configuration or deployment was performed to validate it. Offline fixtures test the API mapping and safety boundaries; device/microphone and authenticated live acceptance remain required.

## Runtime configuration

Set these only through the deployment's private server-side secret/configuration interface. The owner enters the existing API key directly in that trusted interface; never paste it into chat, source, a client/VITE variable, or a committed environment file.

- `ELEVENLABS_API_KEY`: existing restricted ElevenLabs key, server secret.
- `ELEVENLABS_VOICE_ID`: owner-selected accessible voice ID; required for speech output and voice conversion. No voice is guessed.
- `KOVA_VOICE_ENABLED=true`: explicit activation gate.
- `KOVA_VOICE_AUDIO_ENABLED=true`: explicit audio activation, defaults off. STT/STS additionally enforce a strict server-side canonical PCM16 WAV contract: mono, 16 kHz, 0.1–60 seconds derived from the exact sample bytes. The browser normalizes its recording locally before upload. This requires no server decoder or binary.
- `KOVA_VOICE_DAILY_REQUEST_LIMIT`: owner-selected positive integer cap per authenticated user per UTC usage day. Admitted `/api/voice` STT uses one atomic `daily_usage.voice` unit before provider invocation; rejected standalone TTS/STS are not charged. A voice-conversation turn also uses the normal chat quota and `/api/speech`'s separate Read aloud rate limits for its saved reply. These are operational request caps, not promised plan entitlements or currency budgets.
- `KOVA_VOICE_OPENAI_MODELS_JSON` and `KOVA_VOICE_MODEL_PROOF_SECRET`: exact owner-selected OpenAI model IDs and a separate Key Vault-backed random signing secret; both are required for conversation output. Empty or malformed configuration keeps voice output closed without disabling text chat or STT dictation.

Existing backend authentication/database configuration and an explicitly enabled `voice` feature flag are also required. Missing/disabled voice flag fails closed. No migrations are executed; the existing `try_increment_daily_usage` RPC already accepts voice.

Before activation, confirm the cap/eligible user scope, voice choice, provider account/credits and privacy disclosure. Configuring persistent provider credentials requires the owner's secure configuration handoff and approval. The server does not expose or log key values. Do not claim zero provider retention: ElevenLabs logging defaults apply, and documented zero-retention mode is Enterprise-only. Kova's adapter does not persist uploaded audio or response audio; provider processing/retention is separate.

## Contract

POST also requires matching Origin (or same-origin Fetch Metadata when Origin is absent); cross-site requests are rejected before authorization. All calls require the existing authenticated request flow plus `X-Kova-Voice-Owner` matching the captured signed-in account ID. This separate captured-account header prevents an asynchronous auth refresh/account switch from silently billing another account. Missing/mismatched owner returns 409.

- `GET /api/voice`: `{configured, stt, tts:false, sts:false, conversation}` plus safe catalog metadata. `conversation` requires STT, an eligible output voice, `KOVA_SPEECH_ENABLED=true`, and an explicit nonempty OpenAI voice-model policy with a signing secret. It is a configuration signal, not proof that a particular selected chat model will be eligible or the provider will accept a request. Dictate remains STT-only. Banned/unverified/disabled-feature callers fail authorization.
- `POST /api/voice` JSON `{action:"tts",text}`: rejects before quota/provider because arbitrary text has no model provenance. Saved assistant replies use `/api/speech` with a verified model receipt.
- `POST /api/voice` multipart `action=stt`, `audio=<File>`: returns `{text}`.
- `POST /api/voice` multipart `action=sts`, `audio=<File>`: rejects before quota/provider under the model-bound output policy. STS is not a Kova answer.

For a Kova conversation, transcribe to the existing composer, submit through its existing chat flow, and synthesize the actual completed assistant response. The chat server signs a receipt for a complete reply only when its concrete server-selected model is exactly in `KOVA_VOICE_OPENAI_MODELS_JSON` and the text provider is OpenAI. The conversation waits for owned saved-history acknowledgement, then uses `/api/speech` with owner/chat/message IDs, a content fingerprint and an opaque catalog voice ID. That route verifies the receipt against the saved text and current allowlist before quota/provider work, rechecks the authoritative plan/catalog, and requires `KOVA_SPEECH_ENABLED=true`. A different or missing receipt fails closed. Client microphone permission is requested only after an explicit user action. Recording/upload state, Stop/Cancel, transcript review and playback controls remain visible; media tracks and object URLs are cleared on close/account switch/unmount.

Input limits: 5,000 text characters; canonical PCM WAV only, at most 1,920,044 bytes (44-byte header plus 60 seconds of mono PCM16 at 16 kHz); bounded multipart parsing with 64 KiB overhead. The server requires exact RIFF length, fmt/data chunk identities and sizes, PCM format, sample rate, channel count, byte rate, block alignment, bit depth, and exact sample-byte length with no extra data/chunks. Duration is computed from fixed-width samples, never caller metadata. The browser limits its own MediaRecorder output to 8 MiB/60 seconds, decodes that local recording with Web Audio, validates 0.1–60 seconds/one or two channels/8–192 kHz before copying channel data or allocating normalized output, and resamples locally. Browser decode memory itself is managed by the browser; only this UI’s bounded microphone recording is accepted by the helper, never URLs. A conversion failure preserves the original recording for retry/download. Client cancellation closes its AudioContext and discards late decode results. These are safety limits, not promised provider limits or a hard currency budget. Output is bounded to 16 MiB, request duration to 45 seconds, and caller cancellation propagates upstream. A cancelled request may already have incurred provider cost. There are no automatic paid retries. All successful results are `no-store`; provider errors are sanitized.

## Current official API references

- [TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): POST `/v1/text-to-speech/{voice_id}` with `eleven_multilingual_v2`, MP3 output.
- [STT](https://elevenlabs.io/docs/api-reference/speech-to-text/convert): POST `/v1/speech-to-text`, multipart `file`, `scribe_v2`.
- [Voice conversion](https://elevenlabs.io/docs/api-reference/speech-to-speech/convert): POST `/v1/speech-to-speech/{voice_id}`, multipart `audio`, `eleven_multilingual_sts_v2`.
- [Authentication](https://elevenlabs.io/docs/api-reference/authentication): server-side `xi-api-key` authentication.

Checked against official documentation on 2026-10-17. Requests use a fixed provider origin, disallow redirects, and do not accept caller-supplied model IDs, voice IDs, URLs or provider options.

## Offline validation

Run `node --test tests/unit/elevenlabs-voice.test.mjs tests/unit/voice-pcm.test.mjs`. All provider calls in this suite are injected fixtures with synthetic data and a nonfunctional fixture credential. No live/paid request is made.

## Multiple voices and account plans

`KOVA_VOICE_CATALOG` is an optional server-only JSON array of 1–32 owner-reviewed entries. Each entry requires `id` (opaque catalog ID, ASCII letters/digits/underscore/hyphen, 1–64 characters), `label` (nonempty trimmed display text, at most 80 characters, no control characters), `providerVoiceId` (existing accessible ElevenLabs voice ID), and `allowedPlans` (explicit nonempty subset of `free`, `plus`, `pro`, without duplicates). Optional `showWhenLocked: true` explicitly permits displaying the label/catalog ID as a locked choice to other account plans. Omitted/false hides that entry from ineligible accounts. No actual voice, tier mapping, or commercial entitlement is supplied by this code.

`KOVA_VOICE_DEFAULT_ID` optionally selects a catalog ID. If that voice is not allowed for the caller, the first allowed catalog entry is used. A default ID absent from the catalog is invalid configuration. An explicit malformed/empty/oversized/duplicate-ID catalog disables voice entirely; it never falls back to the old voice. Allowed plans are exact sets, not an inferred hierarchy: the owner must include every intended plan.

When `KOVA_VOICE_CATALOG` is absent, the existing valid `ELEVENLABS_VOICE_ID` remains a single `default` entry labeled “Default voice”, preserving its previous all-plan access. With neither catalog nor legacy voice, no output voice is invented. Azure source parameters `voiceCatalog` (default empty array, meaning omit the environment variable) and `voiceDefaultId` (default empty, also omitted) expose this configuration without altering activation flags, quotas, ingress, replicas or credential references.

Every authenticated GET and POST resolves the existing authoritative `getCallerTier`/effective billing entitlement. Client-provided plan claims are ignored. GET additionally returns `voices: [{id,label,available}]` and `defaultVoiceId` (nullable). Only allowed entries and explicitly public locked entries appear; provider IDs, API keys and internal plan lists never appear. `available` means plan eligibility. Standalone TTS/STS capability flags remain false because their client-supplied input cannot prove a completed eligible OpenAI reply. `/api/speech` maps the opaque catalog ID to the server-owned provider ID and model and rejects unknown or plan-locked choices before quota/provider work.

The UI may remember the catalog ID under an account-scoped preference and must validate it against the current available catalog after account or capability changes. This preference is not an entitlement and is not a provider secret. Output voice choice only changes speech rendering. More capable conversation behavior continues through the existing normal chat model selector, routing and verified plan entitlements; this change neither chooses new models nor changes their pricing or access.

### Server-owned speech model selection

Each `KOVA_VOICE_CATALOG` entry may optionally set `modelId` to exactly
`eleven_flash_v2_5`, `eleven_multilingual_v2`, or `eleven_v4`. Omission preserves
`eleven_multilingual_v2`, including the legacy single-voice configuration. An
unsupported explicit value invalidates the complete catalog before quota or
provider access. Client model/provider fields cannot override the selected
catalog entry; only its opaque catalog ID is accepted. Public capabilities do
not expose provider IDs or model configuration. STT and STS models are unchanged.

REST compatibility checked against the official [Text to Speech guide](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)
and [quickstart](https://elevenlabs.io/docs/quickstart) on 2026-10-18. Eleven v4
supports Create speech (`POST /v1/text-to-speech/:voice_id`) and Stream speech;
this implementation uses Create speech. No v4 Turbo/WebSocket support is implied.
Offline mocked transport tests establish request construction, not account model
availability, voice/model acoustic quality, or live provider success.

Prefer an explicitly configured Flash v2.5 entry for low-cost conversational
output across tiers; a paid plan alone need not force a costlier speech model.
An expressive v4 entry can be a deliberate separately selected option. Bind no
real voices until their current IDs, account availability and sample quality are
verified. The daily request allowance remains a request counter, not a currency
budget: different configured models and output lengths incur different charges.
