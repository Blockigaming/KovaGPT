import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("gap ledger leaves no frontend-feasible Partial or Missing capability", async () => {
  const ledger = await read("docs/chatgpt-gap-elimination.md");
  assert.match(ledger, /No meaningful frontend-feasible item remains/);
  assert.doesNotMatch(ledger, /\| PARTIAL \||\| MISSING \|/);
  for (const status of [
    "COMPLETE",
    "BACKEND REQUIRED",
    "PROVIDER REQUIRED",
    "OPENAI INFRASTRUCTURE REQUIRED",
  ])
    assert.match(ledger, new RegExp(status));
});

test("conversation search covers content and useful operators", async () => {
  const [search, palette, sidebar] = await Promise.all([
    read("src/lib/conversation-search.ts"),
    read("src/components/CommandPalette.tsx"),
    read("src/components/Sidebar.tsx"),
  ]);
  for (const operator of ["is:pinned", "has:attachment", "after:", "before:", "in:title:"])
    assert.match(search, new RegExp(operator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(search, /message\.content/);
  assert.match(palette, /searchConversations/);
  assert.match(sidebar, /searchConversations/);
});

test("archived conversations can be discovered, restored, and permanently removed", async () => {
  const [settings, store, chat] = await Promise.all([
    read("src/components/SettingsDialog.tsx"),
    read("src/lib/chat-store.ts"),
    read("src/routes/index.tsx"),
  ]);
  assert.match(settings, /aria-label="Archived chats"/);
  assert.match(settings, /loadArchivedConversations/);
  assert.match(settings, /saveArchivedConversations/);
  assert.match(settings, /Restore/);
  assert.match(settings, /Delete archived chat/);
  assert.match(store, /loadArchivedConversations/);
  assert.match(store, /removeArchivedConversation/);
  assert.match(chat, /historyAction\("archive", id\)/);
  const history = await read("src/lib/home-chat-history-actions.ts");
  assert.match(history, /archiveConversation/);
  assert.match(history, /Undo/);
  assert.match(history, /context\.current/);
});
