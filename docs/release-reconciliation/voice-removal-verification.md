# Voice and browser-dictation removal verification

## Product contract

KovaGPT does not expose Voice mode, browser speech recognition, microphone dictation, a Dictate control, voice-listening state, or voice-only composer callbacks. Ordinary text entry, file upload, image upload, and unrelated accessibility behavior remain unchanged.

## Removed implementation

The composer no longer contains:

- the microphone icon import or Dictate button;
- `SpeechRecognition` or `webkitSpeechRecognition` discovery;
- recognition object references or lifecycle cleanup;
- dictation transcript buffering;
- listening state;
- microphone-permission messaging;
- dictation start and stop callbacks.

## Regression coverage

`tests/integration/voice-absence-source.test.mjs` recursively checks user-facing source for browser voice APIs and inspects the composer for removed dictation state, controls, labels, and microphone components.

One-shot workflow run `31916038564` completed successfully before committing the removal. It ran the new absence contract, the ChatGPT-parity source contract, the UI-quality source contract, TypeScript typecheck, and a production build. The workflow then deleted its temporary definition.

This record does not replace normal required CI on the reconciled stacked branch or final release SHA.
