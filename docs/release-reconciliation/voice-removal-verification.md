# Voice unavailable-state verification

> Superseded scope note (2026-09-12): Voice is required by the September 11 final
> goal. This record now verifies the safe **unavailable** state while that work remains
> unimplemented; it no longer records Voice as a permanent product exclusion.

## Current product contract

KovaGPT does not yet expose Voice mode, browser speech recognition, microphone
dictation, a Dictate control, voice-listening state, or voice-only composer callbacks.
Ordinary text entry, file upload, image upload, and unrelated accessibility behavior
remain unchanged.

Voice may become available only after consent, privacy, safety, latency, provider,
device, per-minute visibility, and backend-cost gates are implemented and accepted.

## Removed legacy implementation

The composer no longer contains:

- the microphone icon import or Dictate button;
- `SpeechRecognition` or `webkitSpeechRecognition` discovery;
- recognition object references or lifecycle cleanup;
- dictation transcript buffering;
- listening state;
- microphone-permission messaging;
- dictation start and stop callbacks.

## Regression coverage

`tests/integration/voice-absence-source.test.mjs` recursively checks user-facing source
for prematurely exposed browser voice APIs, verifies the capability registry declares
Voice as required but unavailable, and inspects the composer for removed dictation
state, controls, labels, and microphone components.

One-shot workflow run `31916038564` completed successfully before committing the
legacy removal. It ran the original absence contract, the ChatGPT-parity source
contract, the UI-quality source contract, TypeScript typecheck, and a production build.
The workflow then deleted its temporary definition.

This historical run does not verify the September 11 Voice requirement and does not
replace normal required CI on the reconciled PR branch or final release SHA.
