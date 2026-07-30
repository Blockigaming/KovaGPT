import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

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
  assert.match(palette, /Start Deep Research/);
  assert.match(palette, /Generate image/);
  assert.match(palette, /Create Scheduled Task/);
});
