import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
test("sidebar Rename has an aligned pencil and the header omits the removed overflow menu", () => {
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
  assert.match(sidebar, /beginRename\(conversation\)\}>\s*<Pencil aria-hidden="true"/);
  assert.match(sidebar, /className="kova-sidebar-chat-menu"/);
  const header = readFileSync("src/components/ConversationHeaderActions.tsx", "utf8");
  assert.doesNotMatch(header, /openDialog\("rename"\)|DropdownMenuTrigger|MoreHorizontal/);
});
test("context menus retain bounded widths and compact SDK rows with coarse targets", () => {
  const sidebar = postcss.parse(readFileSync("src/styles/sidebar-core.css", "utf8"));
  const menu = sidebar.nodes.find((node) => node.selector === ".kova-sidebar-chat-menu");
  assert.ok(menu);
  const values = Object.fromEntries(
    menu.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
  );
  assert.equal(values.width, "min(196px, calc(100vw - 24px))");
  assert.equal(values["max-width"], "calc(100vw - 24px)");
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
  for (const token of ["min-h-8", "rounded-xl", "px-2 py-1.5", "[@media(pointer:coarse)]:min-h-11"])
    assert.ok(shared.includes(token));
});

test("sidebar chat pin is one accessible hover control and the menu floats outside the drawer", () => {
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
  const styles = readFileSync("src/styles/sidebar-core.css", "utf8");
  const shared = readFileSync("src/components/ui/dropdown-menu.tsx", "utf8");
  assert.match(sidebar, /className={`kova-chat-quick-pin/);
  assert.match(sidebar, /aria-pressed={Boolean\(conversation\.pinned\)}/);
  assert.match(sidebar, /fill={conversation\.pinned \? "currentColor" : "none"}/);
  assert.match(sidebar, /onClick={\(event\) => {[\s\S]*?quickTogglePin\(conversation\);/);
  assert.match(
    styles,
    /\.kova-sidebar \.kova-chat-quick-pin\.is-pinned \{\s*color: var\(--foreground\)/,
  );
  assert.doesNotMatch(styles, /\.kova-sidebar \.kova-chat-quick-pin\.is-pinned \{[^}]*opacity: 1/);
  assert.match(
    styles,
    /\.kova-sidebar \.kova-chat-row:hover \.kova-chat-quick-pin,\s*\.kova-sidebar \.kova-chat-quick-pin:focus-visible/,
  );
  assert.match(sidebar, /side={mobileViewport \? "bottom" : "right"}/);
  assert.match(sidebar, /align={mobileViewport \? "end" : "center"}/);
  assert.match(sidebar, /data-sidebar-menu-placement="floating"/);
  assert.match(shared, /<DropdownMenuPrimitive\.Portal>/);
  assert.doesNotMatch(
    sidebar.slice(sidebar.indexOf('className="kova-sidebar-chat-menu"')),
    /Lock chat/,
  );
});
