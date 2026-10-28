import test from "node:test";
import assert from "node:assert/strict";
import {
  voiceModelPolicy,
  eligibleVoiceModel,
  issueVoiceModelReceipt,
  verifyVoiceModelReceipt,
} from "../../src/lib/voice/openai-model-eligibility.server.mjs";

const secret = "fixture signing key that is long enough for HMAC";
const variables = {
  KOVA_VOICE_OPENAI_MODELS_JSON: JSON.stringify(["test-model.one", "test-model-two"]),
  KOVA_VOICE_MODEL_PROOF_SECRET: secret,
};
const env =
  (overrides = {}) =>
  (name) =>
    ({ ...variables, ...overrides })[name];
const identity = {
  ownerId: "owner-123",
  chatId: "chat-456",
  messageId: "assistant-789",
  content: "This is the exact completed reply.",
};
const selected = { provider: "openai", modelId: "test-model.one" };

test("only an explicit, valid, nonempty exact OpenAI model list enables voice", () => {
  const policy = voiceModelPolicy(env());
  assert.equal(policy.valid, true);
  assert.equal(eligibleVoiceModel(policy, selected), true);
  assert.equal(eligibleVoiceModel(policy, { ...selected, modelId: "test-model" }), false);
  assert.equal(eligibleVoiceModel(policy, { ...selected, modelId: "TEST-model.one" }), false);
  assert.equal(eligibleVoiceModel(policy, { ...selected, provider: "azure" }), false);
  assert.equal(eligibleVoiceModel(policy, { ...selected, modelId: "test-model.one/../" }), false);
  for (const raw of [
    undefined,
    "",
    "broken",
    "{}",
    "[]",
    '["test-model.one", "test-model.one"]',
    '["test-model.one", 1]',
    '["test-model.one "]',
    JSON.stringify(["test-model.one".repeat(20)]),
  ]) {
    const malformed = voiceModelPolicy(env({ KOVA_VOICE_OPENAI_MODELS_JSON: raw }));
    assert.equal(malformed.valid, false, String(raw));
    assert.equal(eligibleVoiceModel(malformed, selected), false);
    assert.equal(issueVoiceModelReceipt(malformed, { ...identity, ...selected }), null);
  }
  for (const key of [undefined, "short"]) {
    assert.equal(voiceModelPolicy(env({ KOVA_VOICE_MODEL_PROOF_SECRET: key })).valid, false);
  }
});

test("signed proof authenticates exact owner, chat, message, content and model", () => {
  const policy = voiceModelPolicy(env());
  const receipt = issueVoiceModelReceipt(policy, { ...identity, ...selected });
  assert.equal(typeof receipt, "string");
  assert.deepEqual(verifyVoiceModelReceipt(policy, receipt, identity), selected);
  assert.equal(
    Buffer.from(receipt.split(".")[0], "base64url").toString().includes(identity.content),
    false,
  );
  for (const changed of [
    { ...identity, ownerId: "other-owner" },
    { ...identity, chatId: "other-chat" },
    { ...identity, messageId: "other-message" },
    { ...identity, content: "This is the exact completed reply!" },
  ])
    assert.equal(verifyVoiceModelReceipt(policy, receipt, changed), null);
  assert.equal(
    verifyVoiceModelReceipt(
      voiceModelPolicy(env({ KOVA_VOICE_OPENAI_MODELS_JSON: '["test-model-two"]' })),
      receipt,
      identity,
    ),
    null,
  );
  assert.equal(
    verifyVoiceModelReceipt(
      voiceModelPolicy(env({ KOVA_VOICE_MODEL_PROOF_SECRET: `${secret}-rotated` })),
      receipt,
      identity,
    ),
    null,
  );
});

test("malformed and forged proofs fail closed", () => {
  const policy = voiceModelPolicy(env());
  assert.equal(
    issueVoiceModelReceipt(policy, { ...identity, provider: "azure", modelId: selected.modelId }),
    null,
  );
  assert.equal(
    issueVoiceModelReceipt(policy, { ...identity, provider: "openai", modelId: "unlisted" }),
    null,
  );
  assert.equal(issueVoiceModelReceipt(policy, { ...identity, ...selected, messageId: "" }), null);
  const receipt = issueVoiceModelReceipt(policy, { ...identity, ...selected });
  for (const forged of [
    "",
    "bad",
    `${receipt}x`,
    `${receipt.slice(0, -1)}${receipt.endsWith("A") ? "B" : "A"}`,
    `${receipt.split(".")[0].replace(/.$/, "A")}.${receipt.split(".")[1]}`,
  ]) {
    if (forged !== receipt) assert.equal(verifyVoiceModelReceipt(policy, forged, identity), null);
  }
});
