# Completed-response read aloud

`POST /api/speech` streams ElevenLabs MP3 audio for a verified signed-in user's
saved assistant response. The UI adds Read aloud / Stop to completed, non-temporary
responses. It does not add a microphone, conversational Voice, a new Auth service,
or another text-model adapter.

## Private runtime configuration

Configure these on the server only, using existing private secret custody:

- `ELEVENLABS_API_KEY`: existing key with text-to-speech permission and available
  account credits/entitlement. Never use a `VITE_` prefix or commit a value.
- `ELEVENLABS_VOICE_ID`: an existing voice the account may use. When the optional
  voice catalog is absent, this preserves the legacy default voice with
  `eleven_multilingual_v2`.
- `KOVA_VOICE_CATALOG` and optional `KOVA_VOICE_DEFAULT_ID`: reuse the existing
  [server-owned catalog](voice/elevenlabs-integration.md#multiple-voices-and-account-plans)
  for saved-response speech, including voice-conversation replies. The server
  resolves the selected opaque catalog ID against the caller's authoritative
  effective plan. The entry supplies the provider voice and model. A configured
  catalog needs no legacy `ELEVENLABS_VOICE_ID`; malformed catalogs and invalid or
  plan-locked explicit choices fail before quota/provider work without falling
  back to a different voice or model. No automatic discovery or generation occurs.
- `KOVA_SPEECH_ENABLED=true`: explicit release activation. It defaults off and
  the existing `KOVA_GENERATION_DISABLED=true` emergency switch also disables it.
- Existing authenticated chat-history and distributed-rate-limit dependencies
  remain required. Missing limiter configuration fails closed, without a provider call.

This source work does not authorize secret retrieval, account purchases, paid
generation, public publication, deployment, or runtime activation. No ElevenLabs
key, voice availability, balance, or live account entitlement was inspected.

## Admission, limits and privacy

The browser sends owner/chat/message IDs, a SHA-256 content fingerprint and an
optional opaque catalog `voiceId`. It cannot supply provider IDs, models or text.
The route reuses `requireVerifiedUser`, reads `chat_history_records` with the
verified user client under RLS and an explicit owner filter, and uses the existing
live-principal/deletion-fence check before contacting ElevenLabs and again before
exposing audio. Text comes from the saved owned message, never a browser text field.
The fingerprint rejects a different or stale saved version. Missing history,
temporary/user/failed/stopped messages and pending images are rejected.

The UI's completion gate follows the existing `streaming`, `generationStatus`
and `pendingImage` contract. Saved chat snapshots are owner-editable history,
not cryptographic proof of original model output or server-issued completion.
This does not add a model-output provenance mechanism.

- At most 4,000 UTF-16 text units per request, with no silent truncation.
- Distributed atomic limits: 3 attempts/user/minute, 20/user/hour and 100 globally/hour.
  Each admitted attempt reserves its buckets before provider work. Failure/cancel
  does not refund a reservation. The cap bounds request counts and worst-case text;
  it is not an invoice, a dollar budget, or permission to spend.
- 1 KiB request body; 8 MiB audio; 60-second server/request deadline;
  10-minute maximum browser playback lifecycle; zero automatic retries.
- Stop aborts fetch, cancels the reader, pauses audio and releases its object URL.
  Only one response plays at once. Principal change, account-cache cleanup,
  response change, page exit and unmount stop playback and invalidate late work.
- Provider response bodies/errors and API keys are neither logged nor reflected
  to the browser. Responses use private/no-store headers. Audio is not persisted.
- The response text is sent to ElevenLabs when the user requests Read aloud;
  provider-side retention follows the account's terms/settings. No unsupported
  zero-retention claim or enterprise-only query option is added.

MP3-capable MediaSource browsers play incrementally. Other browsers download the
bounded stream into a Blob before playback; Stop works while loading as well as
while playing. Autoplay/decoder failures produce a clear error. Unsynced responses
return an explicit save/sync error, rather than synthesizing caller-supplied text.

## Source and tests

Protocol reference: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
uses `/v1/text-to-speech/{voice_id}/stream`, `xi-api-key`, the explicit
server-selected catalog model (legacy `eleven_multilingual_v2`) and
`mp3_44100_128` output. Catalog models retain the existing allowlist:
`eleven_flash_v2_5`, `eleven_multilingual_v2`, and `eleven_v4`. This source
allowlist does not establish that the current provider account has access to
any model or voice; that still requires private operator evidence and live
acceptance. Model and voice selection are included in the existing bounded
generation-admission check, so a different catalog choice cannot bypass it.

Focused mocked tests:

```sh
node --test tests/unit/speech.test.mjs tests/unit/multimodal-scope.test.mjs tests/unit/connectors-governance.test.mjs
node --test tests/browser/speech-playback.test.mjs
npx tsc --noEmit
```

The browser fixture requires installed Playwright Chromium, esbuild and ffmpeg;
it synthesizes silence locally, serves a mocked localhost response, and imports
the actual new response control. It does not run the application against a live
provider or use any account credentials. Reuse the supplied result evidence;
rerun after source reconciliation or a demonstrated failure, not unchanged work.
