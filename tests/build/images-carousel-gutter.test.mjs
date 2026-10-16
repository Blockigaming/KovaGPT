import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
const source = readFileSync("src/routes/images.tsx", "utf8");
const classes = source.match(/ref=\{presetsRef\}\s+className="([^"]+)"/)[1];
for (const width of [390, 639, 640, 767, 834, 1023, 1024, 1440])
  test(`Images carousel bleed equals page gutter at${width}`, () => {
    const c = compiledCascade(css, width, width < 1024);
    const root = element("html"),
      content = element("div", "kova-app-content", root);
    const page = element("main", "kova-core-page kova-directory", content);
    const carousel = element("div", classes, page);
    const gutter = width < 1024 ? 20 : 48;
    assert.equal(c.value(carousel, "padding-inline"), `${gutter}px`);
    assert.equal(c.value(carousel, "margin-inline").replaceAll(" ", ""), `calc(-1*${gutter}px)`);
    assert.equal(c.value(carousel, "overflow-x"), "auto");
    assert.notEqual(c.value(content, "overflow-x"), "hidden");
    assert.ok(c.value(page, "padding").includes(`${gutter}px`));
  });
