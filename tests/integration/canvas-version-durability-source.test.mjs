// Canvas edit history must never claim durability it does not have.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
const message = readFileSync("src/components/ChatMessage.tsx", "utf8");

test("durable versions require a signed-in user plus chat and message ids", () => {
  assert.match(editor, /const canPersistVersions = Boolean\(isSignedIn && chatId && messageId\)/);
});

test("an entry is labelled saved only after the server write resolves", () => {
  assert.match(editor, /await saveVersionFn\(\{/);
  assert.match(editor, /durable = true;/);
  assert.match(editor, /label: durable \? "Saved to this chat" : "Session only"/);
  // Unsaved entries carry an explicit badge.
  assert.match(editor, /not saved/);
});

test("save failures surface an error instead of a false success", () => {
  assert.match(editor, /only kept for the current session/);
  assert.match(editor, /role="alert"[\s\S]{0,120}historyError/);
});

test("history copy reflects whether persistence is available", () => {
  assert.match(editor, /Edits are saved to this chat and stay available after you close Canvas\./);
  assert.match(editor, /Versions are kept only while this Canvas is open\./);
});

test("ChatMessage forwards the ids Canvas needs", () => {
  assert.match(message, /chatId=\{chatId \?\? null\}/);
  assert.match(message, /messageId=\{message\.id \?\? null\}/);
});
