import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("dropdown actions use SDK18px icons,6px menu inset and32px desktop/44px coarse rows", () => {
  const source = read("src/components/ui/dropdown-menu.tsx");
  assert.match(source, /\[&_svg\]:size-\[18px\]/);
  assert.match(source, /\[&>svg\]:size-\[18px\]/);
  assert.match(source, /bg-popover p-1\.5/);
  assert.match(source, /min-h-8/);
  assert.match(source, /rounded-xl px-2 py-1\.5/);
  assert.match(source, /\[@media\(pointer:coarse\)\]:min-h-11/);
  assert.match(read("src/styles/visual-tokens.css"), /--kova-radius-menu: 16px/);
});
test("sidebar uses pinned filled SDK glyphs and plugin status retains its20px Lucide icons", () => {
  const sidebar = read("src/styles/sidebar-core.css");
  assert.doesNotMatch(sidebar, /stroke-width: 1\.65/);
  assert.doesNotMatch(sidebar, /stroke-width:/);
  assert.match(sidebar, /width: 20px;\s*height: 20px/);
  const glyphs = read("src/components/SidebarIcons.tsx");
  assert.match(glyphs, /0f00143c7a639906f1621fe58e1b6be7b5bea46d/);
  assert.match(glyphs, /fill="currentColor"/);
  const plugin = read("src/styles/spec400-plugins.css");
  assert.match(plugin, /\.spec400-plugin-status svg \{\s*width: 20px;\s*height: 20px;/);
  assert.match(plugin, /gap: (?:10px|var\(--space-3\))/);
  assert.match(plugin, /gap: var\(--space-2\)/);
  assert.match(plugin, /gap: var\(--space-3\)/);
});

test("audited management action spacing uses existing tokens and retains44px targets", () => {
  const source = read("src/styles/spec400-management.css");
  assert.doesNotMatch(source, /padding: 10px 16px|padding-block: 10px|padding-inline: 10px/);
  assert.match(source, /padding: var\(--space-2\) var\(--space-4\)/);
  assert.match(source, /min-height: 44px/);
});
