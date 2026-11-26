import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const bicep = readFileSync(
  new URL("../../infra/azure/production/main.bicep", import.meta.url),
  "utf8",
);
const params = JSON.parse(
  readFileSync(
    new URL("../../infra/azure/production/main.parameters.example.json", import.meta.url),
    "utf8",
  ),
).parameters;
test("voice deployment defaults remain disabled and unconfigured", () => {
  for (const key of ["speechEnabled", "voiceEnabled", "voiceAudioEnabled"])
    assert.equal(params[key].value, false);
  assert.equal(params.voiceDailyRequestLimit.value, 0);
  for (const key of ["elevenLabsApiKeySecretUri", "elevenLabsVoiceId"])
    assert.equal(params[key].value, "");
  assert.match(bicep, /@secure\(\)\s*param elevenLabsApiKeySecretUri string = ''/);
});
test("saved-response Read aloud has its own explicit default-off production setting", () => {
  assert.match(bicep, /param speechEnabled bool = false/);
  assert.equal(bicep.split("name: 'KOVA_SPEECH_ENABLED'").length, 2);
  assert.match(bicep, /name: 'KOVA_SPEECH_ENABLED'\s*value: speechEnabled \? 'true' : 'false'/);
  assert.doesNotMatch(
    bicep,
    /name: 'KOVA_SPEECH_ENABLED'\s*value: (?:voiceEnabled|voiceAudioEnabled)/,
  );
});
test("voice key is an optional existing Key Vault reference, never a raw environment value", () => {
  assert.match(
    bicep,
    /!empty\(elevenLabsApiKeySecretUri\) \? \[\{\s*name: 'elevenlabs-api-key'\s*keyVaultUrl: elevenLabsApiKeySecretUri\s*identity: identity.id/,
  );
  assert.match(bicep, /name: 'ELEVENLABS_API_KEY'\s*secretRef: 'elevenlabs-api-key'/);
  assert.doesNotMatch(bicep, /name: 'ELEVENLABS_API_KEY'\s*value:/);
  for (const key of [
    "KOVA_VOICE_ENABLED",
    "KOVA_VOICE_AUDIO_ENABLED",
    "KOVA_VOICE_DAILY_REQUEST_LIMIT",
    "ELEVENLABS_VOICE_ID",
  ])
    assert.equal(bicep.split(`name: '${key}'`).length, 2);
});

test("multi-voice deployment configuration is opt-in and preserves single voice defaults", () => {
  assert.deepEqual(params.voiceCatalog.value, []);
  assert.equal(params.voiceDefaultId.value, "");
  assert.match(bicep, /param voiceCatalog array = \[\]/);
  assert.match(
    bicep,
    /!empty\(voiceCatalog\) \? \[\{\s*name: 'KOVA_VOICE_CATALOG'\s*value: string\(voiceCatalog\)/,
  );
  assert.match(
    bicep,
    /!empty\(voiceDefaultId\) \? \[\{\s*name: 'KOVA_VOICE_DEFAULT_ID'\s*value: voiceDefaultId/,
  );
  assert.doesNotMatch(bicep, /allowedPlans: \[/);
});

test("streaming speech model is an optional allowlisted setting; catalog and model allowlist wiring is untouched", () => {
  assert.equal(params.voiceStreamTtsModel.value, "");
  assert.match(bicep, /param voiceStreamTtsModel string = ''/);
  assert.match(
    bicep,
    /@allowed\(\[\s*''\s*'eleven_flash_v2_5'\s*'eleven_v4_turbo'\s*\]\)\s*param voiceStreamTtsModel/,
  );
  assert.match(
    bicep,
    /!empty\(voiceStreamTtsModel\) \? \[\{\s*name: 'KOVA_VOICE_STREAM_TTS_MODEL'\s*value: voiceStreamTtsModel/,
  );
  // The production catalog and foundation model allowlist stay opt-in parameters.
  assert.match(bicep, /name: 'KOVA_VOICE_CATALOG'\s*value: string\(voiceCatalog\)/);
  assert.match(
    bicep,
    /name: 'KOVA_VOICE_OPENAI_MODELS_JSON'\s*value: string\(voiceOpenAiModelIds\)/,
  );
});
