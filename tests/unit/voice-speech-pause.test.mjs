import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceSilenceGate } from "../../src/lib/voice/speech-pause.mjs";

test("ambient silence and isolated short noises never dispatch a voice turn", () => {
  const gate = createVoiceSilenceGate();
  for (const time of [0, 100, 500, 1400, 2400]) assert.equal(gate.sample(0.002, time), false);
  assert.equal(gate.sample(0.03, 2500), false);
  assert.equal(gate.sample(0.001, 2600), false);
  assert.equal(gate.sample(0.001, 4200), false);
  assert.equal(gate.hasSpeech(), false);
});
test("speech followed by a real pause ends exactly one recording", () => {
  const gate = createVoiceSilenceGate();
  assert.equal(gate.sample(0.025, 0), false);
  assert.equal(gate.sample(0.028, 120), false);
  assert.equal(gate.sample(0.03, 240), false);
  assert.equal(gate.hasSpeech(), true);
  assert.equal(gate.sample(0.002, 700), false);
  assert.equal(gate.sample(0.002, 1100), false);
  assert.equal(gate.sample(0.002, 1420), true);
});
test("a pause shorter than the silence window does not split sentences", () => {
  const gate = createVoiceSilenceGate();
  for (const t of [0, 100, 220]) assert.equal(gate.sample(0.03, t), false);
  assert.equal(gate.sample(0.005, 700), false);
  assert.equal(gate.sample(0.034, 800), false);
  assert.equal(gate.sample(0.005, 1500), false);
  assert.equal(gate.sample(0.005, 2000), true);
});
