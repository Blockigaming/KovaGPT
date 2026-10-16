import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
const source = readFileSync("src/components/CommandPalette.tsx", "utf8");
// Bounded box arithmetic from the compiled cascade and actual control classes.
// Not a browser layout engine or physical-device acceptance check.
for (const [width, height, left, right] of [
  [667, 375, 44, 44],
  [390, 844, 0, 0],
])
  test(`search safe content ${width}x${height}, horizontal insets ${left}/${right}`, () => {
    assert.match(source, /kova-search-dialog/);
    assert.match(source, /kova-search-header flex items-center gap-3/);
    assert.match(source, /className="h-10 min-w-0 flex-1/);
    assert.match(
      source,
      /className="flex h-11 w-11 shrink-0[^\"]*"\s+aria-label="Close command palette"/,
    );
    assert.match(source, /className="kova-search-results overflow-y-auto"/);
    const c = compiledCascade(css, width, true),
      root = element("html"),
      overlay = element("div", "kova-search-overlay", root),
      dialog = element("div", "kova-search-dialog", overlay),
      header = element("div", "kova-search-header", dialog),
      results = element("div", "kova-search-results", dialog);
    assert.equal(c.value(overlay, "padding"), "0");
    assert.equal(c.value(dialog, "width"), "100%");
    assert.equal(c.value(dialog, "height"), "100dvh");
    assert.equal(c.value(dialog, "border-radius"), "0");
    const inset = (side, value) => {
      const declaration = c.value(dialog, `padding-${side}`);
      if (declaration === undefined || declaration === "0") return 0;
      assert.equal(declaration, `env(safe-area-inset-${side},0px)`);
      return value;
    };
    const start = 1 + inset("left", left),
      end = width - 1 - inset("right", right);
    assert.equal(c.value(header, "padding"), "12px 16px 12px 24px");
    assert.equal(c.value(results, "padding"), "8px 12px");
    const close = [end - 16 - 44, end - 16];
    const input = [start + 24 + 20 + 12, close[0] - 12];
    const resultActions = [start + 12, end - 12];
    for (const [name, [x1, x2]] of [
      ["close", close],
      ["input", input],
      ["results/actions", resultActions],
    ]) {
      assert.ok(
        x1 >= left && x2 <= width - right && x2 > x1,
        `${name} [${x1},${x2}] inside safe [${left},${width - right}]`,
      );
    }
    assert.equal(c.value(dialog, "padding-left"), "env(safe-area-inset-left,0px)");
    assert.equal(c.value(dialog, "padding-right"), "env(safe-area-inset-right,0px)");
  });
