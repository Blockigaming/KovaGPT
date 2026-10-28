import assert from "node:assert/strict";
import test from "node:test";
import { relayEligibleVoiceChat } from "../../src/lib/voice/chat-model-receipt.server.mjs";
import {
  verifyVoiceModelReceipt,
  voiceModelPolicy,
} from "../../src/lib/voice/openai-model-eligibility.server.mjs";

const policy = voiceModelPolicy(
  (key) =>
    ({
      KOVA_VOICE_OPENAI_MODELS_JSON: '["fixture-model"]',
      KOVA_VOICE_MODEL_PROOF_SECRET: "fixture-only-signing-key-with-enough-bytes",
    })[key],
);
const identity = {
  ownerId: "fixture-owner",
  chatId: "fixture-chat",
  messageId: "fixture-assistant",
  provider: "openai",
  modelId: "fixture-model",
};
function stream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

test("only a completed normalized reply receives a model-bound receipt", async () => {
  const emitted = [];
  const receipt = await relayEligibleVoiceChat(
    stream([
      delta("Kova ").slice(0, 13),
      delta("Kova ").slice(13),
      delta("reply."),
      "data: [DONE]\n\n",
    ]),
    { policy, identity, emit: (frame) => emitted.push(frame) },
  );
  assert.deepEqual(
    verifyVoiceModelReceipt(policy, receipt, {
      ownerId: identity.ownerId,
      chatId: identity.chatId,
      messageId: identity.messageId,
      content: "Kova reply.",
    }),
    { provider: "openai", modelId: "fixture-model" },
  );
  assert.equal(emitted.join(""), `${delta("Kova ")}${delta("reply.")}`);
});

test("incomplete, rejected, too-long or cancelled streams never authorize speech", async () => {
  const options = { policy, identity, emit() {} };
  await assert.rejects(relayEligibleVoiceChat(stream([delta("partial")]), options), {
    code: "chat_stream_missing_done",
  });
  await assert.rejects(
    relayEligibleVoiceChat(
      stream([
        `data: ${JSON.stringify({ choices: [{ delta: { kind: "error", error: "failed" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]),
      options,
    ),
    { code: "chat_stream_provider_error" },
  );
  assert.equal(
    await relayEligibleVoiceChat(stream([delta("x".repeat(4_001)), "data: [DONE]\n\n"]), options),
    null,
  );
  await assert.rejects(
    relayEligibleVoiceChat(stream([delta("reply"), "data: [DONE]\n\n"]), {
      ...options,
      signal: AbortSignal.abort(),
    }),
  );
});

test("explicit non-stop completion never authorizes speech, while native completed streams do", async () => {
  const options = { policy, identity, emit() {} };
  for (const finish_reason of ["length", "content_filter", "tool_calls"]) {
    assert.equal(
      await relayEligibleVoiceChat(
        stream([
          delta("partial reply"),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason }] })}\n\n`,
          "data: [DONE]\n\n",
        ]),
        options,
      ),
      null,
    );
  }
  // Responses native completed frames may not carry a Chat Completions
  // finish_reason; the normal [DONE] boundary still qualifies them.
  const receipt = await relayEligibleVoiceChat(
    stream([delta("completed reply"), "data: [DONE]\n\n"]),
    options,
  );
  assert.deepEqual(
    verifyVoiceModelReceipt(policy, receipt, {
      ownerId: identity.ownerId,
      chatId: identity.chatId,
      messageId: identity.messageId,
      content: "completed reply",
    }),
    { provider: "openai", modelId: "fixture-model" },
  );
});
