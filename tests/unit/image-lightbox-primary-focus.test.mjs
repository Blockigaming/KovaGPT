import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const images = read("src/routes/images.tsx");
const pages = postcss.parse(read("src/styles/core-pages.css"));
const parity = postcss.parse(read("src/styles/chatgpt-parity.css"));
const selector = "[data-image-lightbox] .kova-image-lightbox-primary:focus-visible";
const rule = pages.nodes.find((node) => node.type === "rule" && node.selector === selector);
const declaration = (node, property) =>
  node.nodes.find((entry) => entry.type === "decl" && entry.prop === property);

// Source/cascade regression only. Rendering is verified independently.
test("lightbox autofocus remains on the uniquely identified white primary action", () => {
  assert.equal((images.match(/kova-image-lightbox-primary/g) ?? []).length, 1);
  const button = images.match(/<button\s+ref=\{lightboxInitialFocusRef\}[\s\S]*?<\/button>/)?.[0];
  assert.ok(button);
  assert.match(button, /kova-image-lightbox-primary[^"\n]*bg-white[^"\n]*text-black/);
  assert.match(button, /Reuse prompt/);
  assert.match(button, /setPrompt\(lightbox.prompt\)/);
  assert.match(images, /data-image-lightbox/);
});

test("focused primary action defeats the important generic accent and preserves black-on-white contrast in both themes", () => {
  assert.ok(rule);
  assert.equal(
    rule.parent.type,
    "root",
    "Focus treatment applies in both themes and all viewports",
  );
  for (const [property, value] of [
    ["background", "#fff"],
    ["color", "#000"],
  ]) {
    assert.equal(declaration(rule, property).value, value);
    assert.equal(declaration(rule, property).important, true);
  }
  const generic = parity.nodes.find(
    (node) =>
      node.type === "rule" &&
      node.selector.includes(':where([role="menu"], [role="listbox"], [role="dialog"]') &&
      node.selector.endsWith(":focus-visible"),
  );
  assert.ok(generic);
  assert.equal(declaration(generic, "background").value, "var(--accent)");
  assert.equal(declaration(generic, "background").important, true);
  // Generic :where() contributes zero specificity, leaving :focus-visible (0,1,0).
  // This scoped selector adds an attribute and class, yielding (0,3,0).
  assert.match(
    rule.selector,
    /^\[data-image-lightbox\] \.kova-image-lightbox-primary:focus-visible$/,
  );
  assert.equal(declaration(rule, "opacity").value, "1");
});

test("primary keyboard focus uses the established lightbox close-control contrast bands", () => {
  assert.equal(declaration(rule, "outline").value, "2px solid white");
  assert.equal(declaration(rule, "outline").important, true);
  assert.equal(declaration(rule, "outline-offset").value, "2px");
  assert.equal(declaration(rule, "box-shadow").value, "0 0 0 6px #171717");
  assert.equal(declaration(rule, "box-shadow").important, true);
  const shared = postcss.parse(read("src/styles.css"));
  const close = shared.nodes.find(
    (node) =>
      node.type === "rule" && node.selector === ".image-lightbox > button:last-child:focus-visible",
  );
  for (const property of ["outline", "outline-offset", "box-shadow"])
    assert.equal(declaration(rule, property).value, declaration(close, property).value);
});
