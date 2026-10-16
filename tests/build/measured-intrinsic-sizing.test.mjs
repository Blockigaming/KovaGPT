import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
const pricingSource = readFileSync("src/routes/pricing.tsx", "utf8");
const ctaClasses = pricingSource
  .slice(pricingSource.indexOf("function PlanCard("))
  .match(/className=\{`(inline-flex h-11[^$]+)/)?.[1];
assert.ok(ctaClasses, "actual PlanCard CTA classes");
for (const width of [390, 822, 1188, 1440])
  test(`measured plan track cap and growing CTA ${width}`, () => {
    const c = compiledCascade(css, width, width < 1024),
      root = element("html"),
      page = element("main", "kova-pricing-page", root),
      grid = element("section", "kova-plan-grid", page),
      card = element("article", "kova-plan-card", grid),
      cta = element("button", ctaClasses, card);
    const count = width < 832 ? 1 : width < 1440 ? 2 : 4;
    assert.equal(c.value(grid, "max-width"), `${count * 384 + (count - 1) * 24 + 32}px`);
    assert.equal(c.value(grid, "width"), "100%");
    assert.equal(c.value(grid, "margin-inline"), "auto");
    assert.equal(c.value(card, "min-width"), "0");
    assert.equal(c.value(cta, "height"), "auto");
    assert.equal(c.value(cta, "min-height"), "44px");
    assert.equal(c.value(cta, "padding-block"), "10px");
    assert.equal(c.value(cta, "white-space"), "normal");
    assert.equal(c.value(cta, "overflow-wrap"), "anywhere");
  });
for (const [name, path, tag] of [
  ["Projects", "src/routes/projects.index.tsx", "div"],
  ["Library", "src/routes/library.tsx", "label"],
])
  test(`${name} actual search wrapper uses 240px desktop allocation`, () => {
    const source = readFileSync(path, "utf8");
    const classes = source.match(
      new RegExp(`<${tag} className="([^"]*kova-directory-search[^"]*)"`),
    )?.[1];
    assert.ok(classes, "real search wrapper opt-in");
    for (const width of [390, 822, 1188]) {
      const c = compiledCascade(css, width, width < 1024),
        root = element("html"),
        page = element(
          "main",
          `kova-directory kova-core-page ${name === "Projects" ? "kova-projects-page" : ""}`,
          root,
        ),
        toolbar = element("div", "kova-toolbar", page),
        field = element(tag, classes, toolbar);
      if (width >= 640) {
        assert.equal(c.value(field, "flex"), "0 240px");
        assert.equal(c.value(field, "width"), "240px");
        assert.equal(c.value(field, "max-width"), "100%");
      } else assert.equal(c.value(field, "min-width"), "100%", "retain narrow full row");
    }
  });
