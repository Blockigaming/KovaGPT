import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSUMER_MODELS,
  consumerModel,
  resolveConsumerModelChoice,
  latestCompletedModelReply,
  latestSavedModelReply,
  createConsumerModelChoice,
} from "../../src/lib/consumer-model-selection.mjs";
import { normalizeChatPayload } from "../../src/lib/chat-ingress.server.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
import { routeModel } from "../../src/lib/ai/model-router.mjs";
import { readFileSync } from "node:fs";
import ts from "typescript";

const env = {
  KOVA_MODEL_DEFAULT_CHAT: "kova-argon-4.6",
  KOVA_MODEL_ADVANCED_REASONING: "kova-neon-4.6",
  KOVA_MODEL_PREMIUM_REASONING: "kova-xenon-5",
};
const messages = [{ role: "user", content: "Hello" }];
test("ingress accepts only exact consumer aliases and refuses ambiguous custom selections", () => {
  for (const { id } of CONSUMER_MODELS)
    assert.equal(normalizeChatPayload({ messages, hostedModel: id }).hostedModel, id);
  for (const value of [
    null,
    {},
    "gpt-5",
    "moonshotai/kimi-k3",
    "kova-xenon-4.6",
    "kova-argon-5",
    "kova-neon-4.6 ",
  ])
    assert.throws(() => normalizeChatPayload({ messages, hostedModel: value }), {
      code: "invalid_hosted_model",
    });
  assert.throws(() => normalizeChatPayload({ messages, hostedModel: "kova-argon-4.6", kova: {} }), {
    code: "invalid_hosted_model",
  });
  assert.throws(
    () => normalizeChatPayload({ messages, hostedModel: "kova-argon-4.6", kovaModel: {} }),
    { code: "invalid_hosted_model" },
  );
  assert.equal(consumerModel("__proto__"), null);
});
for (const tier of ["free", "plus", "pro"]) {
  test(`${tier} exact choice survives both simple and complex prompts and every entitled effort`, () => {
    const modes =
      tier === "free"
        ? ["instant", "thinking"]
        : tier === "plus"
          ? ["instant", "medium", "thinking", "high"]
          : ["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"];
    for (const model of CONSUMER_MODELS) {
      for (const mode of modes) {
        const input = {
          task: "chat",
          tier,
          mode,
          hostedModel: model.id,
          env,
          text: "Refactor a distributed system and prove the algorithm's correctness",
          needsTools: true,
          contextChars: 100000,
          historyTurns: 30,
        };
        if (!model.tiers.includes(tier)) {
          assert.throws(() => routeModel(input), /kova_model_not_entitled/);
          continue;
        }
        for (const text of ["Hello", input.text]) {
          const routed = routeModel({ ...input, text });
          assert.equal(routed.modelId, model.id);
          assert.equal(routed.role, model.role);
          assert.equal(routed.downgradedFrom, undefined);
          assert.ok(routed.reasons.includes("explicit_consumer_model"));
        }
      }
    }
  });
}
test("operator role drift and unsupported vision fail closed without a different foundation", () => {
  for (const model of CONSUMER_MODELS) {
    assert.throws(
      () => routeModel({ task: "chat", tier: "pro", hostedModel: model.id, env: {} }),
      /kova_model_runtime_unverified/,
    );
    if (model.vision)
      assert.equal(
        routeModel({ task: "chat", tier: "pro", hostedModel: model.id, hasImages: true, env })
          .modelId,
        model.id,
      );
    else
      assert.throws(
        () =>
          routeModel({ task: "chat", tier: "pro", hostedModel: model.id, hasImages: true, env }),
        /kova_model_vision_unavailable/,
      );
  }
});
test("saved chat round-trips the exact selection and refuses obsolete or provider identifiers", () => {
  const chat = {
    id: "selection-chat",
    title: "Choice",
    mode: "thinking",
    createdAt: 1,
    updatedAt: 2,
    messages: [],
  };
  const owner = "11111111-1111-4111-8111-111111111111";
  for (const model of CONSUMER_MODELS) {
    const saved = normalizeChatHistory({ ...chat, hostedModel: model.id }, owner);
    assert.equal(
      normalizeChatHistory(JSON.parse(JSON.stringify(saved)), owner).hostedModel,
      model.id,
    );
  }
  assert.equal(Object.hasOwn(normalizeChatHistory(chat, owner), "hostedModel"), false);
  assert.throws(
    () => normalizeChatHistory({ ...chat, hostedModel: "kova-xenon-4.6" }, owner),
    /chat_history_invalid/,
  );
});

test("actual API named-choice guard rejects locked, unconfigured and unsupported requests before quota", async () => {
  const source = readFileSync(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8");
  const file = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
  let gate;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(file) === "selectedHostedModel")
      gate = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(gate);
  assert.ok(gate.end < source.indexOf('preflight.run("chat_quota"'));
  const check = new Function(
    "selectedHostedModel",
    "callerTier",
    "modelForRole",
    "currentAttachments",
    gate.getText(file),
  );
  for (const tier of ["free", "plus", "pro"])
    for (const model of CONSUMER_MODELS) {
      const response = check(model, tier, (role) => env[`KOVA_MODEL_${role}`], []);
      if (model.tiers.includes(tier)) assert.equal(response, undefined);
      else {
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "kova_model_not_entitled");
      }
    }
  const selected = CONSUMER_MODELS[0];
  const wrongRole = check(selected, "pro", () => "kova-xenon-5", []);
  assert.equal(wrongRole.status, 503);
  assert.equal((await wrongRole.json()).code, "kova_model_runtime_unverified");
  const unsupported = check(selected, "free", () => selected.id, [{ kind: "image" }]);
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).code, "kova_model_vision_unavailable");
});

test("transient choice stays scoped and model changes require the current entitlement", () => {
  const choice = createConsumerModelChoice("kova-xenon-5", "pro", true, "owner-a", "chat-a");
  assert.equal(resolveConsumerModelChoice(choice, "owner-a", "chat-a"), "kova-xenon-5");
  assert.equal(resolveConsumerModelChoice(choice, "owner-b", "chat-a"), "kova-argon-4.6");
  assert.equal(
    resolveConsumerModelChoice(choice, "owner-a", "chat-b", "kova-neon-4.6"),
    "kova-neon-4.6",
  );
  assert.equal(createConsumerModelChoice("kova-xenon-5", "plus", true, "owner-a", "chat-a"), null);
  assert.equal(
    createConsumerModelChoice("kova-neon-4.6", "plus", false, "owner-a", "chat-a"),
    null,
  );
});

test("model-bound reply lookup preserves the last completed assistant through pending turns", () => {
  const completed = { id: "complete", role: "assistant", content: "Verified answer" };
  const messages = [
    completed,
    { role: "user" },
    { role: "assistant", generationStatus: "streaming" },
    { role: "assistant", pendingImage: true },
  ];
  assert.equal(latestCompletedModelReply(messages), completed);
  assert.equal(latestCompletedModelReply(undefined), undefined);
  assert.deepEqual(messages[0], completed);
});

test("saved model playback requires a completed receipt, saved chat and nonempty text", () => {
  const reply = {
    role: "assistant",
    id: "reply",
    content: "Answer",
    voiceModelReceipt: { model: "argon" },
  };
  const chat = { id: "chat", messages: [reply] };
  assert.deepEqual(latestSavedModelReply(chat), {
    chatId: "chat",
    messageId: "reply",
    content: "Answer",
  });
  for (const candidate of [
    null,
    { ...chat, temporary: true },
    { ...chat, messages: [{ ...reply, voiceModelReceipt: undefined }] },
    { ...chat, messages: [{ ...reply, content: " " }] },
    { ...chat, messages: [{ ...reply, generationStatus: "streaming" }] },
  ])
    assert.equal(latestSavedModelReply(candidate), undefined);
});
