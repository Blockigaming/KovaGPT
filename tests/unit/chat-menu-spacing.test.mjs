import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("both chat Rename actions have aligned pencil icons", () => {
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
  assert.match(
    sidebar,
    /beginRename\(conversation\)\}>\s*<Pencil className="mr-2 h-4 w-4" aria-hidden="true"/,
  );
  assert.match(sidebar, /className="kova-sidebar-chat-menu"/);
  assert.match(
    readFileSync("src/components/ConversationHeaderActions.tsx", "utf8"),
    /openDialog\("rename"\)\}>\s*<Pencil aria-hidden="true"/,
  );
});
test("menu changes widen horizontally without increasing row heights", () => {
  const sidebar = readFileSync("src/styles/sidebar-core.css", "utf8").split(
    "/* Wider chat actions",
  )[1];
  assert.match(sidebar, /width: 208px/);
  assert.match(sidebar, /calc\(100vw - 24px\)/);
  assert.match(sidebar, /padding-inline: 12px/);
  assert.doesNotMatch(sidebar, /min-height|padding-block/);
  const header = readFileSync("src/components/conversation-header.css", "utf8");
  assert.match(header, /\.kova-conversation-menu \{\s*width: 288px/);
  assert.match(header, /min-height: 44px;\s*padding: 10px 16px/);
});
