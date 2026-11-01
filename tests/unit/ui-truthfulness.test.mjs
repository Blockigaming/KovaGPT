import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  auditUiTruthfulness,
  inspectProductionVoiceSource,
} from "../../scripts/release/ui-truthfulness.mjs";
import {
  inspectUnavailableVoiceSource,
  inspectConfiguredVoiceComposer,
  inspectConfiguredVoiceDialog,
} from "../../scripts/release/voice-unavailable-contract.mjs";

test("visible KovaGPT controls keep truthful operational states and guarded Voice mounting", () => {
  const result = auditUiTruthfulness();
  assert.ok(result.checkedFiles > 0, "UI audit must inspect visible source files");
  assert.deepEqual(result.errors, []);
});

const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
test("production composer mounts the two explicit controls through the real dialog boundary", () => {
  assert.deepEqual(inspectProductionVoiceSource(composer), {
    errors: [],
    configuredControlCount: 2,
  });
});

const configuredComposer = `
const review = <>
<button type="button" data-testid="dictate-button" aria-label="Type with voice" aria-haspopup="dialog"
  disabled={disabled} onClick={(event) => openVoice("dictate", event.currentTarget)}><Mic /></button>
<button type="button" data-testid="voice-button" aria-label="Voice" aria-haspopup="dialog"
  disabled={disabled} onClick={(event) => openVoice("voice", event.currentTarget)}><AudioLines /></button>
<ComposerVoiceDialog open={activeVoiceMode !== null} onOpenChange={setVoiceOpenMode}
 mode={activeVoiceMode} userId={userId} contextKey={contextKey} disabled={disabled}
 onTranscript={acceptVoiceTranscript} onVoiceSubmit={submitVoiceTranscript}
 latestAssistantText={latestAssistantText} isStreaming={isStreaming}/></>;
`;
const inspect = inspectConfiguredVoiceComposer;
test("configured composer admits both explicit modes while the absence validator still rejects active Voice", () => {
  assert.deepEqual(inspect(configuredComposer), { errors: [], configuredControlCount: 2 });
  assert.ok(inspectUnavailableVoiceSource(configuredComposer).errors.length > 0);
});
for (const [name, source] of [
  [
    "stale dictation label",
    configuredComposer.replace('aria-label="Type with voice"', 'aria-label="Dictate"'),
  ],
  ["unlabelled trigger", configuredComposer.replace('aria-label="Voice"', "")],
  [
    "capture click",
    configuredComposer.replace('openVoice("voice", event.currentTarget)', "beginAudioSession()"),
  ],
  [
    "wrong mode",
    configuredComposer.replace(
      'openVoice("voice", event.currentTarget)',
      'openVoice("dictate", event.currentTarget)',
    ),
  ],
  ["missing disabled guard", configuredComposer.replace("disabled={disabled}", "")],
  ["missing owner", configuredComposer.replace("userId={userId}", "userId={null}")],
  [
    "missing draft callback",
    configuredComposer.replace("onTranscript={acceptVoiceTranscript}", "onTranscript={() => {}}"),
  ],
  [
    "missing turn callback",
    configuredComposer.replace("onVoiceSubmit={submitVoiceTranscript}", ""),
  ],
  ["missing dialog", configuredComposer.replace(/<ComposerVoiceDialog[\s\S]*?\/>/, "")],
  ["second dormant dialog", configuredComposer + "\nconst hidden = <ComposerVoiceDialog />;"],
  [
    "pointer handler",
    configuredComposer.replace(
      'data-testid="voice-button"',
      'onPointerDown={beginAudioSession} data-testid="voice-button"',
    ),
  ],
  [
    "spread handler",
    configuredComposer.replace(
      'data-testid="voice-button"',
      '{...audioHandlers} data-testid="voice-button"',
    ),
  ],
  ["extra icon", configuredComposer + "\nconst extra = <button><Mic /></button>;"],
])
  test(`configured trigger rejects ${name}`, () => assert.ok(inspect(source).errors.length > 0));

test("production route permits only voiceMode props on ChatInput, never direct capture or extra Voice controls", () => {
  const route = "const view = <ChatInput voiceMode={composerVoiceMode} />;";
  assert.deepEqual(inspectProductionVoiceSource(route), {
    errors: [],
    disconnectedControlCount: 0,
  });
  for (const source of [
    route + "\nconst voiceMode = true;",
    route + "\nconst audio = new Audio();",
    route + '\nconst extra = <button aria-label="Voice">Voice</button>;',
    route + "\nconst hidden = <ComposerVoiceDialog />;",
  ])
    assert.ok(inspectProductionVoiceSource(source).errors.length > 0);
});

for (const capture of [
  "navigator.mediaDevices.getUserMedia({ audio: true })",
  'navigator.mediaDevices["getUserMedia"]({ audio: true })',
  "new MediaRecorder(stream)",
  "new SpeechRecognition()",
  "speechSynthesis.speak(utterance)",
  'fetch("https://api.elevenlabs.io/v1/text-to-speech/example")',
  'fetch("/api/voice")',
  'runtimeEnv("ELEVENLABS_API_KEY")',
]) {
  test(`composer does not permit ${capture}`, () => {
    assert.ok(
      inspectUnavailableVoiceSource(
        composer + `\nconst prohibited = () => ${capture};`,
      ).errors.some((error) => error.startsWith("active voice/capture/provider contract")),
    );
  });
}

test("voice dialog rejects direct provider requests and browser credentials", () => {
  const base = readFileSync("src/components/ComposerVoiceDialog.tsx", "utf8");
  assert.deepEqual(inspectConfiguredVoiceDialog(base).errors, []);
  for (const bypass of [
    "ELEVENLABS_API_KEY",
    "OPENAI_API_KEY",
    "https://api.openai.com",
    "xi-api-key",
    "https://api.elevenlabs.io",
    "process.env.SECRET",
    "speechSynthesis.speak()",
  ])
    assert.ok(inspectConfiguredVoiceDialog(base + " " + bypass).errors.length > 0);
});

test("dialog audit requires explicit capture and cleanup gates", () => {
  const source = readFileSync("src/components/ComposerVoiceDialog.tsx", "utf8");
  for (const token of [
    "!capabilities.stt",
    "!capabilities.tts",
    "track.stop()",
    "URL.revokeObjectURL(",
    "onClick={() => void startRecording()}",
    "onVoiceSubmit",
    "createSpeechPlayback",
    "contentSha256",
    "pagehide",
    "PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT",
  ])
    assert.ok(inspectConfiguredVoiceDialog(source.replaceAll(token, "removed")).errors.length > 0);
});
