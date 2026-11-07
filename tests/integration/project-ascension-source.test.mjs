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

test("chat retirement has no archive UI or recoverable Trash path", async () => {
  const [settings, sidebar, chat, history, deletion, shell] = await Promise.all([
    read("src/components/SettingsDialog.tsx"),
    read("src/components/Sidebar.tsx"),
    read("src/routes/index.tsx"),
    read("src/lib/home-chat-history-actions.ts"),
    read("src/lib/permanent-chat-delete.ts"),
    read("src/components/AppShell.tsx"),
  ]);
  assert.doesNotMatch(
    settings,
    /aria-label="Archived chats"|Delete archived chat|<ArchivedChatsPanel/,
  );
  assert.doesNotMatch(sidebar, /onArchive|>\s*Archive\s*</);
  assert.doesNotMatch(chat, /historyAction\("archive", id\)/);
  assert.match(history, /permanentlyDeleteChat\(context\.ownerId, chat, context\.current\)/);
  assert.match(shell, /permanentlyDeleteChat\(userKey, chat, current\)/);
  assert.match(deletion, /confirmPermanentChat/);
  assert.match(deletion, /clearDraft\(owner, chat\.id\)/);
  assert.doesNotMatch(history, /Undo|moveChatToTrash/);
});
