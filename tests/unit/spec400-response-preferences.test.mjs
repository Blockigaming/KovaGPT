import assert from "node:assert/strict";
import test from "node:test";
import { withResponsePresentation } from "../../src/lib/spec400-response-preferences.mjs";

test("presentation uses the existing contract and explicitly gives the current request priority", () => {
  const profile = {
    customInstructions: "Keep my terminology.",
    responseLength: "short",
    rememberAcross: false,
  };
  const result = withResponsePresentation(profile, {
    responseTone: "formal",
    responseFormat: "plain",
  });
  assert.equal(result.responseLength, "short");
  assert.equal(result.rememberAcross, false);
  assert.match(result.customInstructions, /^Keep my terminology\./);
  assert.match(
    result.customInstructions,
    /Explicit instructions in the current message.*take priority/,
  );
  assert.match(result.customInstructions, /Do not shorten an explicitly detailed request/);
  assert.match(result.customInstructions, /professional language/);
  assert.match(result.customInstructions, /plain text/);
  assert.deepEqual(Object.keys(result), Object.keys(profile));
  assert.equal(profile.customInstructions, "Keep my terminology.");
});
test("no configured presentation leaves profile unchanged and oversized instructions are never truncated", () => {
  const profile = { customInstructions: "x".repeat(8_000) };
  assert.equal(withResponsePresentation(profile, {}), profile);
  assert.equal(
    withResponsePresentation(profile, { responseTone: "direct", responseFormat: "automatic" }),
    profile,
  );
});
