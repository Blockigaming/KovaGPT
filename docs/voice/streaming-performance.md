# Voice streaming, acknowledgments and latency

Live (hands-free) Voice speaks while the Kova reply is still being generated. Saved-message Read aloud and
the existing `live-reply` path are unchanged and remain the fallback.

## Flow

1. The browser sends the chat request exactly as before (same model, reasoning effort, plan limits).
2. While the eligible model streams, `relayEligibleVoiceChat` cuts the text into speakable segments
   (`speech-segmenter.mjs`: first cut at the earliest clause, then whole sentences; punctuation stays in
   the text so the TTS model can pause and intone; markdown and code are not spoken) and emits a
   `voice_segment` SSE event for each, signed with an HMAC receipt.
3. The browser (`streaming-playback.mjs`) POSTs each segment to `/api/speech` (`mode: "live-segment"`),
   up to three in parallel, and appends the returned MP3 bytes, in order, to one gapless audio sink.
4. When the reply is saved, the existing whole-reply receipt flow completes unchanged. If nothing was
   spoken (no speakable text, or streaming failed before audio), the old `live-reply` path plays instead.

## What is preserved

| Property                              | How                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication                        | Same `requireVerifiedUser`, origin check and principal revalidation on every segment.                                                                                                                                                                                                                                                                                                                     |
| Model provenance                      | A segment receipt (`v: 2`, keys `c,h,i,m,n,o,p,v`) binds owner, chat, reply ID, segment index, exact text digest, provider and model. It is signed only by the chat route for an allowlisted model (`KOVA_VOICE_OPENAI_MODELS_JSON`, approved hosted models) and cannot be accepted as a whole-reply receipt, nor the reverse. Tampered text, another reply, another index or an unlisted model gets 403. |
| Moderation / output authorization     | Only text relayed from the authenticated, already-moderated chat stream is signed. The speech route never accepts unsigned text in this mode.                                                                                                                                                                                                                                                             |
| Usage accounting                      | Plan daily voice quota (`enforceQuota(..., "voice", ...)`) and the three paid-provider rate buckets are charged **once per reply**, even when segments arrive in parallel (per-turn admission ledger). A different reply is a new charge. A denied reply stays denied.                                                                                                                                    |
| Abuse limits                          | Max 48 segments, 1000 characters per segment, 4000 per reply; replaying a segment index is 409; ledger is bounded and expires after 10 minutes.                                                                                                                                                                                                                                                           |
| Model and effort                      | Nothing in this path chooses or lowers the chat model or reasoning effort. Client hints (`search`, `reasoning`) only select which acknowledgment may play.                                                                                                                                                                                                                                                |
| Plan entitlements and voice selection | Unchanged (Free: Jessica; Plus: three voices; Pro: all; changed only in Settings).                                                                                                                                                                                                                                                                                                                        |

Multi-replica note: the ledger is per instance. A reply whose segments hit two replicas can be charged
twice (conservative, never free). Sticky sessions or a shared ledger would remove this; not needed for
correctness.

## Speech models

`/api/speech` live segments use `KOVA_VOICE_STREAM_TTS_MODEL`, allowlisted to `eleven_flash_v2_5`
(default) or `eleven_v4_turbo` (`STREAM_TTS_MODEL_IDS`). Catalog voices keep their own models; adding
the streaming allowlist does not change what a catalog entry may select.

Evaluation (from ElevenLabs' published material, September 2026; not measured on our account):

| Model                                   | Median inference                  | Notes                                                                             |
| --------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| Eleven v4 Turbo (`eleven_v4_turbo`)     | ~100 ms (~150 ms to first speech) | Most expressive low-latency option; audio tags; bidirectional streaming.          |
| Eleven Flash v2.5 (`eleven_flash_v2_5`) | ~75 ms                            | Lowest latency, less expressive. Current default; already used by direct speech.  |
| Eleven v3 Conversational                | ~280 ms                           | Expressive, slower. Its API model ID was not confirmed, so it is not allowlisted. |

**Eleven v4 Turbo is confirmed working on our existing subscription** (owner-confirmed; no plan change). Set
`voiceStreamTtsModel=eleven_v4_turbo` in the production parameters (maps to `KOVA_VOICE_STREAM_TTS_MODEL`) to use it;
leave it empty for Flash v2.5.

Each segment is sent with the previous segment as `previous_text` so intonation continues across cuts.

## Acknowledgments

Clips "Let me check that.", "Let me think about that." and "Give me a moment." are generated once per
configured voice and served as static files from `/voice-acks/<voiceId>/`:

```sh
ELEVENLABS_API_KEY=... KOVA_VOICE_CATALOG='<production catalog JSON>' node scripts/generate-voice-acks.mjs
```

The generated `public/voice-acks/` clips (all nine) are committed. They are fetched once per session and cached in memory. A missing clip is
skipped silently. Policy (`acknowledgments.mjs`):

- Search/tool step known: clip due 450 ms after end of speech. Extended-reasoning mode: 600 ms.
- Unknown reason: only if the reply is truly late (1500 ms).
- At most one per turn; never once real speech has been dispatched; they go through the same sink as the reply,
  so they can never overlap it.

## Experience

- One glow stays visible through connecting, listening, thinking, searching and speaking (breathing while
  not audio-driven, audio-reactive while listening and speaking).
- No visible "Starting Voice…", "Kova is speaking…" or "Resume" text. Status is still announced via a
  polite live region; errors stay visible; a small icon-only "Resume Voice" button appears only when paused.
- After the reply finishes, listening resumes automatically.
- Barge-in: while Kova speaks, the microphone (echo-cancelled) is compared with Kova's own output level
  (`barge-in.mjs`); sustained speech clearly above it stops playback immediately and starts listening.

## Latency measurement

`voice-latency.mjs` records, per turn, in memory only (no text, audio or identifiers):

- `firstFeedback`: end of user speech to first audible audio (acknowledgment or reply).
- `firstSubstantive`: end of user speech to first audible audio of the real reply.
- `interrupt`: user speech over Kova to playback silenced.

On a real device, after a few turns: `window.__kovaVoiceLatency.summary()` returns count, p50 and p95 for
each. `node scripts/benchmark-voice-latency.mjs` runs the real playback engine against **simulated**
model and TTS latencies (labelled synthetic; use it for regressions, not as production numbers).

## Known limits

- iOS Safari has no MP3 `MediaSource`, so it uses a Web Audio segment sink (`webaudio-sink.mjs`): the
  AudioContext is unlocked inside the mic/voice tap, each segment is decoded as it completes and scheduled
  gaplessly. Playback starts per segment, not per chunk. Untested on a physical iOS device here.
- Barge-in thresholds are conservative and untested on physical speakers/headsets here.
- `firstSubstantive` after an acknowledgment is estimated from the clip length.
