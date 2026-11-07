import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync("src/routes/library.tsx", "utf8");
test("retired Library folder controls and folder movement are absent", () => {
  assert.doesNotMatch(source, /<LibraryFolderOrganizer|Move to folder/);
  assert.match(source, /setFolderScopeState\(\{ principal, scope: "all" \}\)/);
});
test("selection retains its download and permanent-delete actions", () => {
  assert.match(source, /Selected items deleted/);
  assert.match(source, /LibrarySelectedDownloadsDialog/);
  assert.match(source, /permanentlyDeleteChat\(userKey, chat, isCurrent, true\)/);
});
