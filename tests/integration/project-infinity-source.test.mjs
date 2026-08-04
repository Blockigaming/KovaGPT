import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");


test("Command Palette is global, discoverable, and keyboard configurable", async () => {
  const [shell, palette, shortcuts] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/components/CommandPalette.tsx"),
    read("src/lib/shortcuts.ts"),
  ]);
  assert.match(shell, /kova-open-search/);
  assert.match(palette, /Search chats, apps, files, and actions/);
  assert.match(shortcuts, /Search chats/);
  assert.match(shortcuts, /Mod\+K/);
});

test("Library reuses real Chat, Work, Research, Context Pack, and persistence flows", async () => {
  const library = await read("src/routes/library.tsx");
  assert.match(library, /openInWork/);
  assert.match(library, /continueInResearch/);
  assert.match(library, /addToContextPack/);
  assert.match(library, /listMyLibrary/);
  assert.match(library, /listWorkspaceRecents/);
});

test("Library requires explicit selection before bulk actions", async () => {
  const library = await read("src/routes/library.tsx");
  assert.match(library, /Selected Library actions/);
  assert.match(library, /deleteSelected/);
  assert.doesNotMatch(library, /localStorage\.setItem\(HISTORY_KEY/);
});

test("Command Palette executes Search and theme commands without removed Lens commands", async () => {
  const palette = await read("src/components/CommandPalette.tsx");

test("the ChatGPT-like shell omits the legacy global Lens overlay", async () => {
  const [root, palette, shortcuts] = await Promise.all([
    read("src/routes/__root.tsx"),
    read("src/components/CommandPalette.tsx"),
    read("src/lib/shortcuts.ts"),
  ]);
  assert.doesNotMatch(root, /KovaLens/);
  assert.doesNotMatch(palette, /Open Kova Lens|kova-open-lens/);
  assert.doesNotMatch(shortcuts, /open-lens/);
});

test("Command Palette executes search, theme, and direct KovaGPT workflows", async () => {
  const [palette, sidebar] = await Promise.all([
    read("src/components/CommandPalette.tsx"),
    read("src/components/Sidebar.tsx"),
  ]);

  assert.match(palette, /kova-open-search/);
  assert.match(sidebar, /addEventListener\("kova-open-search", openSearch\)/);
  assert.match(sidebar, /setSearchOpen\(true\)/);
  assert.match(sidebar, /#sidebar-chat-search/);
  assert.match(palette, /applyThemeMode/);

  assert.doesNotMatch(palette, /kova-open-lens/);

  assert.match(palette, /Start Deep Research/);
  assert.match(palette, /Generate image/);
  assert.match(palette, /Scheduled Tasks status/);

});
