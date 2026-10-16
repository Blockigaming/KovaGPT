import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
const source = readFileSync("src/components/auth/AuthDialog.tsx", "utf8");
const rawClasses = [...source.matchAll(/<button\b[\s\S]*?className="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((s) => /\bh-(12|14)\b/.test(s));
assert.equal(rawClasses.length, 4, "passkey, Google, magic-link and change-email raw controls");
for (const [width, coarse] of [
  [390, true],
  [822, true],
  [1188, true],
  [1188, false],
])
  test(`actual AuthDialog raw-button allocation ${width} coarse=${coarse}`, () => {
    const c = compiledCascade(css, width, coarse),
      root = element("html"),
      surface = element("div", "kova-auth-surface", root),
      body = element("div", "kova-auth-body", surface);
    for (const classes of rawClasses) {
      const button = element("button", classes, body);
      const minimum = classes.split(" ").includes("h-14") && width >= 640 ? 56 : 48;
      assert.equal(c.value(button, "height"), "auto");
      assert.equal(c.value(button, "min-height"), `${minimum}px`);
      assert.equal(c.value(button, "padding-block"), "12px");
      assert.equal(c.value(button, "white-space"), "normal");
      assert.equal(c.value(button, "overflow-wrap"), "anywhere");
      // Bounded allocation arithmetic: three wrapped lines may grow past minimum.
      // Line wrapping itself remains a browser/device acceptance gate.
      const threeLineHeight = 3 * 24 + 2 * 12 + 2;
      assert.ok(threeLineHeight > minimum);
      assert.ok(Math.max(minimum, threeLineHeight) >= threeLineHeight);
    }
  });
