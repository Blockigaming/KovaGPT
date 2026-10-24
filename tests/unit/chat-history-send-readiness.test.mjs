import assert from "node:assert/strict";
import test from "node:test";
import {
  canSendChatHistory,
  closeChatHistoryOwner,
  registerChatHistoryView,
} from "../../src/lib/chat-history-bridge.ts";

test("send waits for a registered, ready, writable owner and stops when that owner closes", () => {
  const owner = "readiness-owner";
  assert.equal(canSendChatHistory(owner), false);
  const view = { ready: false, writable: false };
  const unregister = registerChatHistoryView(owner, view);
  assert.equal(canSendChatHistory(owner), false);
  view.ready = true;
  assert.equal(canSendChatHistory(owner), false);
  view.writable = true;
  assert.equal(canSendChatHistory(owner), true);
  closeChatHistoryOwner(owner);
  assert.equal(canSendChatHistory(owner), false);
  unregister();
  assert.equal(canSendChatHistory(owner), false);
});

test("guest sending needs no saved-history view and a new owner cannot inherit readiness", () => {
  assert.equal(canSendChatHistory(null), true);
  const unregister = registerChatHistoryView("ready-owner", { ready: true, writable: true });
  assert.equal(canSendChatHistory("ready-owner"), true);
  assert.equal(canSendChatHistory("different-owner"), false);
  unregister();
  assert.equal(canSendChatHistory("ready-owner"), false);
});
