import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const path = "src/routes/help.tsx";
const source = process.env.KOVA_REGRESSION_BASE
  ? execFileSync("git", ["show", "a578d6cb422aaad40690c2343a9e79d82c500f50:" + path], {
      encoding: "utf8",
    })
  : readFileSync(path, "utf8");
const dir = "dist/client/assets/";
const css = readFileSync(dir + readdirSync(dir).find((n) => /^styles-.*\.css$/.test(n)), "utf8");
for (const width of [320, 390, 834, 1440])
  test(`Help label rows have the same explicit 16px minimum at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      heights = [];
    for (const id of ["support-name", "support-email"]) {
      const rowClass = source.match(
        new RegExp('<div className="([^"]+)">\\s+<Label htmlFor="' + id + '"'),
      )[1];
      const root = element("html"),
        section = element("section", "", root, { id: "support-form" });
      const row = element("div", rowClass, section);
      const height = c.value(row, "min-height");
      // Tailwind spacing is .25rem;4 units reserve1rem (16px at the product root size).
      assert.equal(height, "calc(.25rem * 4)");
      heights.push(height);
      assert.equal(c.value(row, "margin-bottom"), "calc(.25rem * 2)");
    }
    assert.equal(heights[0], heights[1]);
  });
