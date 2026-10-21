import assert from "node:assert/strict";
import test from "node:test";
import { reviewVoiceCapabilities } from "../../review-kit/private-http-review.mjs";
test("sample voice catalog is explicit and never enables provider operations", () => {
  for (const account of ["guest", "free", "plus", "pro"]) {
    const ordinary = reviewVoiceCapabilities(account, "default");
    assert.deepEqual(ordinary.voices, []);
    const proposal = reviewVoiceCapabilities(account, "voice-catalog");
    for (const key of ["configured", "stt", "tts", "sts"]) assert.equal(proposal[key], false);
    assert.equal(proposal.voices.length, account === "guest" ? 0 : 3);
    assert.ok(
      proposal.voices.every((v) => v.id.startsWith("sample-") && v.label.startsWith("Sample ·")),
    );
  }
  assert.deepEqual(
    reviewVoiceCapabilities("free", "voice-catalog").voices.map((v) => v.available),
    [true, false, false],
  );
  assert.deepEqual(
    reviewVoiceCapabilities("plus", "voice-catalog").voices.map((v) => v.available),
    [true, true, false],
  );
  assert.deepEqual(
    reviewVoiceCapabilities("pro", "voice-catalog").voices.map((v) => v.available),
    [true, true, true],
  );
});
