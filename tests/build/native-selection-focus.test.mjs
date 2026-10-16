import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
// Explicit pseudo-state fixtures, not browser keyboard/render evidence.
const states = (css) =>
  css
    .replaceAll(":focus-visible", "[data-test-focus-visible]")
    .replace(/:focus(?![\w-])/g, "[data-test-focus]")
    .replace(/:checked(?![\w-])/g, "[data-test-checked]");
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
const old = execFileSync(
  "git",
  ["show", "8b634b3bea1a4f1472831dc7696442961a546355:src/styles/chatgpt-parity.css"],
  { encoding: "utf8" },
);
const current = readFileSync("src/styles/chatgpt-parity.css", "utf8");
for (const dark of [false, true])
  for (const width of [390, 1440])
    test(`Native selection keyboard outline ${width} dark=${dark}`, () => {
      const c = compiledCascade(states(css), width, width < 768),
        root = element("html", dark ? "dark" : "");
      for (const scope of [
        "",
        "kova-secondary-page",
        "kova-settings-dialog",
        "kova-auth-surface",
      ]) {
        const page = element("main", scope, root);
        for (const type of ["checkbox", "radio"])
          for (const checked of [false, true]) {
            const attrs = {
              type,
              "data-test-focus": "",
              "data-test-focus-visible": "",
              ...(checked ? { "data-test-checked": "" } : {}),
            };
            const input = element("input", "", page, attrs);
            assert.match(c.value(input, "outline"), /^2px solid /);
            assert.equal(c.value(input, "outline-offset"), "2px");
            assert.equal(c.value(input, "box-shadow"), "none");
            assert.equal(c.value(input, "appearance"), "auto");
            assert.ok(c.value(input, "accent-color"));
            assert.doesNotMatch(c.value(input, "outline"), /transparent|undefined/);
          }
      }
    });
test("Native focus correction leaves text-field/custom controls and non-keyboard styling unchanged", () => {
  const a = compiledCascade(states(old), 390, true),
    b = compiledCascade(states(current), 390, true),
    root = element("html");
  for (const tag of ["input", "textarea", "select", "button"])
    for (const type of ["text", "checkbox", "radio"])
      for (const keyboard of [false, true]) {
        if (tag === "input" && ["checkbox", "radio"].includes(type) && keyboard) continue;
        const target = element(tag, "", root, {
          type,
          role: type,
          "data-test-focus": "",
          ...(keyboard ? { "data-test-focus-visible": "" } : {}),
        });
        for (const p of ["outline", "outline-offset", "box-shadow", "border-color"])
          assert.equal(b.value(target, p), a.value(target, p));
      }
});
