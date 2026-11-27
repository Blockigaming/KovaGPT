import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_HISTORY_LIMITS } from "../../src/lib/chat-history-policy.mjs";
import {
  CONVERSATION_MESSAGE_LIMITS,
  conversationLimitReached,
  conversationMessageLimit,
} from "../../src/lib/conversation-limits.mjs";

test("Pro allows the longest conversations, Plus the middle, Free the shortest", () => {
  assert.ok(CONVERSATION_MESSAGE_LIMITS.free < CONVERSATION_MESSAGE_LIMITS.plus);
  assert.ok(CONVERSATION_MESSAGE_LIMITS.plus < CONVERSATION_MESSAGE_LIMITS.pro);
  assert.ok(CONVERSATION_MESSAGE_LIMITS.pro <= CHAT_HISTORY_LIMITS.messages);
});

test("the limit blocks only once a conversation is full", () => {
  assert.equal(conversationLimitReached("free", CONVERSATION_MESSAGE_LIMITS.free - 1), false);
  assert.equal(conversationLimitReached("free", CONVERSATION_MESSAGE_LIMITS.free), true);
  assert.equal(conversationMessageLimit("unknown"), CONVERSATION_MESSAGE_LIMITS.free);
});
