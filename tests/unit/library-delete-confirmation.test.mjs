import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const { libraryDeleteConfirmation: summary } = loadUiModule(
  "src/lib/library-delete-confirmation.ts",
  {},
);
test("all Library chat, file, and Work removals describe one permanent confirmation", () => {
  for (const id of ["chat:one", "work:one", "file:one"]) {
    for (const legacyRetention of [null, 0, 86400000]) {
      const result = summary([{ id, title: "Saved item" }], legacyRetention);
      assert.equal(result.title, "Delete “Saved item” permanently?");
      assert.equal(result.confirmLabel, "Delete permanently");
      assert.match(result.description, /cannot be restored/);
      assert.doesNotMatch(result.description, /Trash|separate confirmation/);
    }
  }
});
test("bulk deletion describes the exact number of selected items", () => {
  const result = summary([
    { id: "chat:a", title: "A" },
    { id: "file:b", title: "B" },
  ]);
  assert.equal(result.title, "Delete 2 Library items permanently?");
});
test("Library deletion keeps the owner generation, confirmation snapshot, and close-time identity guard", () => {
  const source = readFileSync("src/routes/library.tsx", "utf8");
  assert.match(source, /setPendingDelete\(\{ kind, items: snapshot, principal, generation \}\)/);
  assert.match(source, /confirmedDeleteRef.current = pending/);
  assert.match(source, /origin.generation === lifecycleGenerationRef.current/);
  assert.match(source, /if \(!current \|\| !confirmed\) return/);
  assert.doesNotMatch(source, /readChatTrash|moveChatToTrash/);
});
