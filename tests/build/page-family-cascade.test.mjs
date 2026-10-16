import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
for (const width of [500, 822, 1188, 1440])
  test(`shared page-family cascade at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768, width, {
      "image-gallery": width - (width >= 1024 ? 96 : 40),
    });
    const root = element("html"),
      directory = element("main", "kova-page kova-core-page kova-directory", root),
      heading = element("h1", "kova-page-title", directory),
      toolbar = element("section", "kova-toolbar", directory),
      row = element("div", "kova-row kova-directory-row", directory),
      gallery = element("section", "kova-image-gallery", directory),
      grid = element("div", "kova-image-gallery-grid", gallery);
    assert.equal(c.value(directory, "max-width"), "1440px");
    assert.equal(
      c.value(directory, "padding"),
      `24px ${width >= 1024 ? "48px" : "20px"} max(48px, env(safe-area-inset-bottom,0px))`,
    );
    if (width < 1024)
      assert.equal(
        c.value(directory, "padding-bottom"),
        "max(48px, env(safe-area-inset-bottom,0px))",
      );
    assert.equal(c.value(heading, "font-size"), width < 768 ? "18px" : "24px");
    assert.equal(c.value(heading, "font-weight"), "500");
    assert.equal(c.value(toolbar, "gap"), "12px");
    assert.equal(c.value(row, "min-height"), "70px");
    const columns = width === 500 ? 2 : width === 822 ? 4 : width === 1188 ? 5 : 6;
    assert.equal(c.value(grid, "grid-template-columns"), `repeat(${columns},minmax(0,1fr))`);
    const overlay = element("div", "kova-search-overlay", root),
      dialog = element("div", "kova-search-dialog", overlay),
      results = element("div", "kova-search-results", dialog),
      option = element("button", "", results, { role: "option" });
    assert.equal(c.value(dialog, "width"), width < 768 ? "100%" : "min(720px,100vw - 32px)");
    assert.equal(c.value(dialog, "border-radius"), width < 768 ? "0" : "16px");
    assert.equal(c.value(option, "min-height"), "48px");
    assert.equal(c.value(option, "border-radius"), "12px");
    const profile = element("div", "kova-profile-menu", root, { role: "menu" }),
      item = element("div", "", profile, { role: "menuitem" });
    assert.equal(c.value(profile, "width"), "228px");
    assert.equal(c.value(profile, "border-radius"), "16px");
    assert.equal(c.value(profile, "padding"), "10px");
    assert.equal(c.value(item, "min-height"), width < 768 ? "44px" : "36px");
    const pricing = element("main", "kova-pricing-page", root),
      plans = element("section", "kova-plan-grid", pricing),
      card = element("article", "kova-plan-card", plans),
      cta = element("button", "", card);
    assert.equal(
      c.value(plans, "grid-template-columns"),
      width < 832
        ? "minmax(0,1fr)"
        : width < 1440
          ? "repeat(2,minmax(0,1fr))"
          : "repeat(4,minmax(0,1fr))",
    );
    assert.equal(c.value(card, "max-width"), "384px");
    assert.equal(c.value(card, "border-radius"), "24px");
    assert.equal(c.value(card, "padding"), "23px 23px 25px");
    assert.equal(c.value(cta, "min-height"), "44px");
    const settings = element("div", "kova-settings-dialog", root, { role: "dialog" }),
      setting = element("div", "kova-settings-row", settings);
    assert.equal(c.value(setting, "min-height"), "64px");
    assert.equal(c.value(setting, "border-radius"), "16px");
    assert.equal(c.value(setting, "gap"), "24px");
    const help = element("main", "kova-help-page", root),
      search = element("input", "kova-help-search", help);
    assert.equal(c.value(help, "max-width"), "1064px");
    assert.equal(c.value(search, "height"), "64px");
    assert.equal(c.value(search, "border-width"), "0 0 1px");
    assert.equal(c.value(search, "border-radius"), "0");
  });
