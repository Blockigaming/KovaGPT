import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { voiceConfiguration } from "../../src/lib/voice/elevenlabs.server.mjs";
import ts from "typescript";

function composerElements(source) {
  const file = ts.createSourceFile(
    "ChatInput.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elements = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const attribute = (element, name) =>
    element.attributes.properties.find(
      (node) => ts.isJsxAttribute(node) && node.name.getText(file) === name,
    )?.initializer;
  return { file, elements, attribute };
}

// The legacy filename is retained by the release runner. The disconnected-only
// assertion is obsolete: capture is now confined to the real mounted dialog.
test("composer mounts distinct Dictate and Voice controls with real owner, draft and assistant context", async () => {
  const source = await readFile("src/components/ChatInput.tsx", "utf8");
  const { file, elements, attribute } = composerElements(source);
  const dialogs = elements.filter(
    (element) => element.tagName.getText(file) === "ComposerVoiceDialog",
  );
  assert.equal(
    dialogs.length,
    1,
    "One dialog owns microphone, transcription and playback lifecycle",
  );
  for (const name of [
    "open",
    "onOpenChange",
    "userId",
    "contextKey",
    "onTranscript",
    "latestAssistantText",
    "isStreaming",
    "mode",
    "onVoiceSubmit",
  ]) {
    const value = attribute(dialogs[0], name);
    assert.ok(value && ts.isJsxExpression(value) && value.expression, `${name} must be wired`);
    assert.doesNotMatch(value.expression.getText(file), /^(?:undefined|null|""|false)$/u, name);
  }
  for (const id of ["dictate-button", "voice-button"]) {
    const controls = elements.filter((element) => {
      const testId = attribute(element, "data-testid");
      return testId && ts.isStringLiteral(testId) && testId.text === id;
    });
    assert.equal(controls.length, 1, `${id} must have one separate explicit control`);
    assert.ok(attribute(controls[0], "onClick"), `${id} must open through an explicit click`);
    const type = attribute(controls[0], "type");
    assert.ok(type && ts.isStringLiteral(type) && type.text === "button", `${id} must not submit`);
  }
  assert.doesNotMatch(source, /Voice is not connected|Voice \(not connected\)/u);
  assert.doesNotMatch(
    source,
    /getUserMedia|new\s+MediaRecorder/u,
    "Opening controls must delegate capture to the dialog",
  );
});

test("browser voice surfaces keep provider credentials and native Web Speech APIs out of the client", async () => {
  for (const file of [
    "src/components/ChatInput.tsx",
    "src/components/ChatMessage.tsx",
    "src/components/ComposerVoiceDialog.tsx",
    "src/components/ComposerVoiceDialogView.tsx",
    "src/components/ResponseSpeechButton.tsx",
    "src/lib/voice-recording.ts",
    "src/lib/speech-playback.mjs",
  ]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /\b(?:SpeechRecognition|webkitSpeechRecognition|SpeechSynthesisUtterance|speechSynthesis|OPENAI_API_KEY|ELEVENLABS_API_KEY)\b|xi-api-key|api\.elevenlabs\.io|api\.openai\.com/u,
      file,
    );
  }
  const registry = await readFile("src/lib/capability-registry.ts", "utf8");
  assert.match(registry, /voiceScope:\s*"required_provider_dependent"/u);
  assert.match(registry, /voice:\s*\{[\s\S]*?availability:\s*"provider-dependent"/u);
  assert.doesNotMatch(registry, /voiceScope:\s*"excluded"/u);
});

test("microphone policy permits only same-origin use without granting cross-origin access", async () => {
  for (const entry of ["src/start.ts", "src/server.ts"]) {
    const securitySource = await readFile(entry, "utf8");
    assert.match(
      securitySource,
      /microphone=\(self\)/u,
      `${entry} must restrict microphone access to the same origin`,
    );
    assert.doesNotMatch(securitySource, /microphone=\((?!self\))[^)]*\)/u);
  }
});

test("source support does not turn on unconfigured or globally disabled runtime audio", () => {
  const base = {
    ELEVENLABS_API_KEY: "synthetic-fixture-only-key",
    ELEVENLABS_VOICE_ID: "syntheticVoice",
    KOVA_VOICE_ENABLED: "true",
    KOVA_VOICE_AUDIO_ENABLED: "true",
    KOVA_VOICE_DAILY_REQUEST_LIMIT: "20",
  };
  const config = (values) => voiceConfiguration((key) => values[key]);
  for (const values of [
    {},
    { ...base, KOVA_VOICE_ENABLED: "false" },
    { ...base, KOVA_GENERATION_DISABLED: "true" },
    { ...base, KOVA_REQUEST_CAPTURE_ENABLED: "true" },
    { ...base, KOVA_GENERATION_ACCEPTANCE_ENABLED: "true" },
  ]) {
    const actual = config(values);
    assert.equal(actual.configured, false);
    assert.equal(actual.stt, false);
    assert.equal(actual.tts, false);
    assert.equal(actual.sts, false);
  }
  const actual = config(base);
  assert.equal(actual.configured, true);
  assert.equal(actual.stt, true);
  assert.equal(actual.tts, true);
  assert.equal(actual.sts, true);
  const noAudio = config({ ...base, KOVA_VOICE_AUDIO_ENABLED: "false" });
  assert.equal(noAudio.stt, false);
  assert.equal(noAudio.sts, false);
  assert.equal(noAudio.tts, true);
});
