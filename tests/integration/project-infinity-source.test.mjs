import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Kova Lens is global, discoverable, and keyboard configurable", async () => {
  const [root, lens, palette, shortcuts] = await Promise.all([
    read("src/routes/__root.tsx"),
    read("src/components/KovaLens.tsx"),
    read("src/components/CommandPalette.tsx"),
    read("src/lib/shortcuts.ts"),
  ]);
  assert.match(root, /<KovaLens/);
  assert.match(palette, /Open Kova Lens/);
  assert.match(shortcuts, /open-lens/);
  assert.match(shortcuts, /Mod\+Shift\+K/);
  assert.match(lens, /installShortcutListener/);
});

test("Lens reuses real Chat, Work, Research, Context Pack, and Library flows", async () => {
  const lens = await read("src/components/KovaLens.tsx");
  assert.match(lens, /kova-prompt-launch/);
  assert.match(lens, /openInWork/);
  assert.match(lens, /continueInResearch/);
  assert.match(lens, /addToContextPack/);
  assert.match(lens, /useServerFn\(saveToLibrary\)/);
});

test("Lens requires explicit action and keeps recall history tab scoped", async () => {
  const lens = await read("src/components/KovaLens.tsx");
  assert.match(lens, /sessionStorage\.setItem\(HISTORY_KEY/);
  assert.match(lens, /Nothing is sent until you choose an action/);
  assert.doesNotMatch(lens, /localStorage\.setItem\(HISTORY_KEY/);
});

test("Command Palette executes Search, theme, and Lens commands", async () => {
  const palette = await read("src/components/CommandPalette.tsx");
  assert.match(palette, /kova-open-search/);
  assert.match(palette, /applyThemeMode/);
  assert.match(palette, /kova-open-lens/);
});
