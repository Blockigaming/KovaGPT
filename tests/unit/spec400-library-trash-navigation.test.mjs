import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const library = readFileSync("src/routes/library.tsx", "utf8");
test("Library single and bulk chat removal reuse recoverable Trash", () => {
  assert.equal(
    (library.match(/await moveChatToTrash\(userKey, chat, chats, isCurrent\)/g) || []).length,
    2,
  );
  assert.doesNotMatch(library, /saveConversations/);
  assert.match(library, /libraryDeleteConfirmation\(/);
  assert.match(library, /readChatTrash\(userKey\)\.retentionMs/);
  const confirmation = readFileSync("src/lib/library-delete-confirmation.ts", "utf8");
  assert.match(confirmation, /will move to Trash and can be restored for/);
  assert.match(confirmation, /your current retention setting/);
  assert.match(library, /if \(isCurrent\(\)\) restoreDeletedItem\(\)/);
});
test("management shell exposes its existing workspace-search handler", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");
  assert.match(
    shell,
    /onOpenWorkspaceSearch=\{\(\) => window.dispatchEvent\(new CustomEvent\("kova-open-search"\)\)\}/,
  );
});
