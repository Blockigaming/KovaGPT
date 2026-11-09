import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("voice meter derives its visual level only from local recorded audio", () => {
  const controller = source("../../src/components/ComposerVoiceDialog.tsx");
  const view = source("../../src/components/ComposerVoiceDialogView.tsx");
  const styles = source("../../src/components/composer-voice.css");

  assert.match(controller, /analyser\.getFloatTimeDomainData\(samples\)/u);
  assert.match(controller, /const amplitude = Math\.sqrt\(total \/ samples\.length\)/u);
  assert.match(controller, /setInputLevel\(Math\.min\(1, amplitude \* 8\)\)/u);
  assert.match(controller, /if \(next !== "recording"\) setInputLevel\(0\)/u);
  assert.match(
    controller,
    /inputLevel=\{mode === "voice" && phase === "recording" && !microphoneMuted \? inputLevel : 0\}/u,
  );
  assert.match(view, /Math\.max\(0, Math\.min\(1, inputLevel\)\)/u);
  assert.match(styles, /\[data-voice-phase="recording"\] \.kova-voice-orb-glow/u);
  assert.doesNotMatch(view, /getUserMedia|AudioContext|navigator\.mediaDevices/u);
});
