import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
const entrypoints = [
  ["sidebar", "src/components/Sidebar.tsx", 'aria-label="Account menu"'],
  ["header", "src/components/auth/ClerkSafe.tsx", "export function UserButton("],
];
for (const [name, path, anchor] of entrypoints) {
  const source = readFileSync(path, "utf8");
  assert.ok(source.includes(anchor));
  const menuClass = source
    .slice(source.indexOf(anchor))
    .match(/<DropdownMenuContent\b[^>]*className="([^"]+)"/)?.[1];
  for (const [width, coarse] of [
    [500, true],
    [822, true],
    [1188, true],
    [1188, false],
  ])
    test(`${name} profile menu source-connected cascade ${width}px coarse=${coarse}`, () => {
      assert.ok(
        menuClass?.split(/\s+/).includes("kova-profile-menu"),
        "real entrypoint opts into shared profile presentation",
      );
      const c = compiledCascade(css, width, coarse),
        root = element("html"),
        menu = element("div", menuClass, root, { role: "menu" }),
        item = element("div", "", menu, { role: "menuitem" });
      assert.equal(c.value(menu, "width"), "228px");
      assert.equal(c.value(menu, "padding"), "10px");
      assert.equal(c.value(menu, "border-radius"), "16px");
      assert.equal(c.value(item, "min-height"), coarse || width < 768 ? "44px" : "36px");
      assert.equal(c.value(item, "border-radius"), "12px");
    });
}
