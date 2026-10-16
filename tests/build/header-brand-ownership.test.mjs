import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((name) => /^styles-.*\.css$/.test(name));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
for (const width of [390, 1023, 1024, 1440]) {
  for (const state of ["open", "closed"]) {
    test(`chat branding ownership at ${width}px, sidebar ${state}`, () => {
      const cascade = compiledCascade(css, width, width < 1024);
      const app = element("div", "kova-assistant", element("html"));
      const main = element("main", "kova-chat-main", app, { "data-sidebar": state });
      const desktop = element("header", "kova-topbar kova-desktop-topbar", main);
      const group = element("div", "flex flex-1", desktop);
      const brand = element("span", "kova-model-static inline-flex", group);
      const mobile = element("header", "kova-topbar", main);
      const mobileBrand = element("span", "kova-model-static inline-flex", mobile);
      const controls = element("div", "flex", desktop);
      const control = element("button", "kova-topbar-button inline-flex", controls);
      assert.equal(
        cascade.value(brand, "display"),
        width >= 1024 && state === "open" ? "none" : "inline-flex",
      );
      assert.equal(cascade.value(mobileBrand, "display"), "inline-flex");
      assert.equal(cascade.value(control, "display"), "inline-flex");
      assert.equal(cascade.value(group, "display"), "flex");
    });
  }
}
