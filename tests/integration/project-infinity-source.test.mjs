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
