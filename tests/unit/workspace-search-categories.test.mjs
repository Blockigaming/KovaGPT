import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Search chats has accessible result-type tabs and Clear without rewriting queries", () => {
  const source = readFileSync("src/components/CommandPalette.tsx", "utf8");
  assert.match(source, /role="tablist"[\s\S]*aria-label="Search result type"/);
  assert.match(source, /\["all", "chats", "images", "documents", "projects"\]/);
  assert.match(source, /role="tab"\s+aria-selected={searchView === view}/);
  assert.match(source, /aria-label="Clear search"/);
  assert.match(source, /showChats = searchView === "all" \|\| searchView === "chats"/);
  assert.match(source, /searchView === "images"\s*\?\s*item.type === "image"/);
  assert.match(source, /searchView === "documents"\s*\?\s*item.type === "library"/);
  assert.match(source, /searchView === "projects"\s*\?\s*item.type === "project"/);
  assert.match(source, /onSelectChat\(chat.id\)/);
  assert.match(source, /if \(open\) setSearchView\("all"\)/);
});
