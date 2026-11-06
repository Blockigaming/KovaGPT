import test from "node:test";
import assert from "node:assert/strict";
import { automaticMemorySource } from "../../src/lib/reviewed-memory-policy.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
const chat = {
  id: "test-chat",
  title: "Question",
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: "u", role: "user", content: "What is 17 × 23?", createdAt: 1 },
    { id: "a", role: "assistant", content: "391.", createdAt: 2 },
  ],
};
test("one completed exchange is eligible; temporary boundaries, pending images and failed replies are excluded", () => {
  assert.equal(automaticMemorySource(chat, owner).messageCount, 2);
  for (const next of [
    { ...chat, temporary: true },
    { ...chat, memoryStartIndex: 2 },
    { ...chat, messages: chat.messages.slice(0, 1) },
    { ...chat, messages: [chat.messages[0], { ...chat.messages[1], generationStatus: "failed" }] },
    { ...chat, messages: [chat.messages[0], { ...chat.messages[1], content: "" }] },
  ])
    assert.throws(() => automaticMemorySource(next, owner));
});
test("exact message instants survive durable history normalization; malformed instants are rejected", () => {
  assert.equal(normalizeChatHistory(chat, owner).messages[1].createdAt, 2);
  assert.throws(() =>
    normalizeChatHistory(
      { ...chat, messages: [{ ...chat.messages[0], createdAt: Infinity }] },
      owner,
    ),
  );
  const legacy = structuredClone(chat);
  delete legacy.messages[1].createdAt;
  assert.equal(normalizeChatHistory(legacy, owner).messages[1].createdAt, undefined);
});
