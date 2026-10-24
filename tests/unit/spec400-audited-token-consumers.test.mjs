import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("audited dropdown actions use20px icons and8px menu inset", () => {
  const source = read("src/components/ui/dropdown-menu.tsx");
  assert.match(source, /\[&_svg\]:size-5/);
  assert.match(source, /\[&>svg\]:size-5/);
  assert.doesNotMatch(source, /bg-popover p-1\.5/);
  assert.match(source, /bg-popover p-2/);
});
test("sidebar and plugin status use the ordinary Lucide stroke without changing supplied logos", () => {
  const sidebar = read("src/styles/sidebar-core.css");
  assert.doesNotMatch(sidebar, /stroke-width: 1\.65/);
  assert.match(sidebar, /stroke-width: var\(--kova-icon-stroke, 2\)/);
  const plugin = read("src/styles/spec400-plugins.css");
  assert.match(plugin, /\.spec400-plugin-status svg \{\s*width: 20px;\s*height: 20px;/);
  assert.doesNotMatch(plugin, /(?:gap: (?:6|10)px|padding: 8px 14px)/);
  assert.match(plugin, /gap: var\(--space-2\)/);
  assert.match(plugin, /gap: var\(--space-3\)/);
});

test("audited management action spacing uses existing tokens and retains44px targets", () => {
  const source = read("src/styles/spec400-management.css");
  assert.doesNotMatch(source, /padding: 10px 16px|padding-block: 10px|padding-inline: 10px/);
  assert.match(source, /padding: var\(--space-2\) var\(--space-4\)/);
  assert.match(source, /min-height: 44px/);
});
