import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
test("enabled voice review uses pure presentation and contains no capture or provider implementation", () => {
  const fixture = read("review-kit/voice-preview.tsx");
  assert.match(fixture, /ComposerVoiceDialogView/);
  assert.match(fixture, /Synthetic interaction only/);
  assert.doesNotMatch(
    fixture,
    /getUserMedia|MediaRecorder|authFetch|\bfetch\s*\(|AudioContext|ELEVENLABS_API_KEY/,
  );
  const view = read("src/components/ComposerVoiceDialogView.tsx");
  assert.doesNotMatch(
    view,
    /getUserMedia|MediaRecorder|authFetch|\bfetch\s*\(|AudioContext|localStorage/,
  );
});
test("private preview serves required presentation CSS and exposes an explicit state-review entry", () => {
  const builder = read("review-kit/build-plugin-preview.mjs");
  const server = read("review-kit/private-http-review.mjs");
  assert.match(builder, /voice-preview\.css/);
  assert.match(server, /Voice interaction states/);
  assert.match(server, /review\/voice-preview\.css/);
});
test("voice state review is selectable inside the existing responsive review frame", () => {
  const server = read("review-kit/private-http-review.mjs");
  const paths = server.slice(
    server.indexOf("export const PATHS"),
    server.indexOf("]);", server.indexOf("export const PATHS")),
  );
  assert.match(paths, /"\/__private-review\/voice-preview"/);
});
