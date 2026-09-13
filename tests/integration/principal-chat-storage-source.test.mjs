import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("home chat and shared shell hide stale account state before loading the next principal", async () => {
  const [home, shell] = await Promise.all([
    read("src/routes/index.tsx"),
    read("src/components/AppShell.tsx"),
  ]);

  assert.match(home, /const storagePrincipal = chatStoragePrincipal\(userKey\)/);
  assert.match(home, /conversationState\.principal === storagePrincipal/);
  assert.match(home, /const EMPTY_CONVERSATIONS: Conversation\[\] = \[\]/);
  assert.match(
    home,
    /const conversations = principalReady \? conversationState\.items : EMPTY_CONVERSATIONS/,
  );
  assert.match(home, /storagePrincipalRef\.current !== storagePrincipal/);
  assert.match(home, /abortRef\.current\?\.abort\(\)/);
  assert.match(home, /loadConversations\(userKey\)/);
  assert.match(home, /saveConversations\(\s*userKey,/);

  assert.match(shell, /const storagePrincipal = chatStoragePrincipal\(userKey\)/);
  assert.match(shell, /const conversations = principalReady \? conversationState\.items : \[\]/);
  assert.match(shell, /loadConversations\(userKey\)/);
  assert.match(shell, /saveConversations\(userKey, next\)/);
});

test("draft, pending-selection, archive, import, and export paths carry the current principal", async () => {
  const [home, shell, settings] = await Promise.all([
    read("src/routes/index.tsx"),
    read("src/components/AppShell.tsx"),
    read("src/components/SettingsDialog.tsx"),
  ]);

  assert.match(home, /draftStorageKey\(userKey, activeId\)/);
  assert.match(home, /loadDraft\(userKey, activeId\)/);
  assert.match(home, /saveDraft\(userKey, activeId, input\)/);
  assert.match(home, /loadPendingActive\(userKey\)/);
  assert.match(home, /clearPendingActive\(userKey\)/);
  const history = await read("src/lib/home-chat-history-actions.ts");
  assert.match(home, /ownerId: userKey/);
  assert.match(history, /archiveConversation\(context\.ownerId, chat\)/);
  assert.match(history, /removeArchivedConversation\(context\.ownerId, chat\.id\)/);
  assert.match(history, /if \(!context\.current\(\)\) return/);
  assert.doesNotMatch(
    home,
    /localStorage\.(?:getItem|setItem|removeItem)\("nova-gpt-pending-active"/,
  );
  assert.doesNotMatch(home, /localStorage\.(?:getItem|setItem|removeItem)\(`kova-draft:/);

  assert.match(shell, /savePendingActive\(userKey, id\)/);
  assert.match(shell, /clearPendingActive\(userKey\)/);
  assert.doesNotMatch(
    shell,
    /localStorage\.(?:getItem|setItem|removeItem)\("nova-gpt-pending-active"/,
  );

  assert.match(settings, /conversations: loadConversations\(userKey\)/);
  assert.match(settings, /archivedConversations: loadArchivedConversations\(userKey\)/);
  assert.match(settings, /saveConversations\(userKey, conversations\)/);
  assert.match(settings, /saveArchivedConversations\(userKey, archived\)/);
  assert.match(settings, /<ArchivedChatsPanel userKey=\{userKey\} \/>/);
});

test("legacy unscoped keys are read only by the guest migration", async () => {
  const store = await read("src/lib/chat-store.ts");

  assert.match(store, /if \(current !== null \|\| userKey !== null\) return current/);
  assert.match(store, /const LEGACY_CONVERSATIONS_KEY = "nova-gpt-conversations-v2"/);
  assert.match(store, /const LEGACY_ARCHIVED_KEY = "kovagpt:archived"/);
  assert.match(store, /const LEGACY_DRAFT_KEY_BASE = "kova-draft"/);
  assert.match(store, /const LEGACY_PENDING_ACTIVE_KEY = "nova-gpt-pending-active"/);
  assert.match(store, /localStorage\.removeItem\(legacyKey\)/);
});
