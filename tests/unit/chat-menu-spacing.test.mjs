import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
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
test("context menus retain bounded widths and compact SDK rows with coarse targets", () => {
  const sidebar = postcss.parse(readFileSync("src/styles/sidebar-core.css", "utf8"));
  const menu = sidebar.nodes.find((node) => node.selector === ".kova-sidebar-chat-menu");
  assert.ok(menu);
  const values = Object.fromEntries(
    menu.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
  );
  assert.equal(values.width, "208px");
  assert.match(values["max-width"], /--radix-dropdown-menu-content-available-width/);
  assert.match(values["max-width"], /calc\(100vw - 24px\)/);
  assert.ok(
    !values["min-height"] && !values["padding-block"],
    "Sidebar width does not override shared row geometry",
  );
  const header = readFileSync("src/components/conversation-header.css", "utf8");
  assert.match(header, /\.kova-conversation-menu \{\s*width: 256px/);
  assert.match(header, /min-height: 32px;\s*padding: 6px 8px;\s*gap: 6px/);
  assert.match(
    header,
    /@media \(max-width: 1023px\), \(any-pointer: coarse\)[\s\S]*min-height: 44px/,
  );
  const shared = readFileSync("src/components/ui/dropdown-menu.tsx", "utf8");
  for (const token of [
    "min-h-8",
    "rounded-[6px]",
    "px-2 py-1.5",
    "[@media(pointer:coarse)]:min-h-11",
  ])
    assert.ok(shared.includes(token));
});
