import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const images = read("src/routes/images.tsx");
const pages = postcss.parse(read("src/styles/core-pages.css"));
const geometry = postcss.parse(read("src/styles/control-geometry.css"));
const selector = "[data-image-lightbox] .kova-image-lightbox-primary:focus-visible";
const rule = pages.nodes.find((node) => node.type === "rule" && node.selector === selector);
const declaration = (node, property) =>
  node.nodes.find((entry) => entry.type === "decl" && entry.prop === property);

// Source/cascade regression only. Rendering is verified independently.
test("lightbox autofocus remains on the uniquely identified white primary action", () => {
  assert.equal((images.match(/kova-image-lightbox-primary/g) ?? []).length, 1);
  const parsed = ts.createSourceFile(
    "images.tsx",
    images,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let button;
  const visit = (node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(parsed) === "ref" &&
          attribute.initializer?.getText(parsed) === "{lightboxInitialFocusRef}",
      )
    )
      button = node.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(button);
  assert.match(button, /kova-image-lightbox-primary[^"\n]*bg-white[^"\n]*text-black/);
  assert.match(button, /Reuse prompt/);
  assert.match(button, /setPrompt\(lightbox.prompt\)/);
  assert.match(images, /data-image-lightbox/);
});

test("focused primary action preserves black-on-white contrast while generic accent is limited to menus", () => {
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
  const generic = geometry.nodes.filter(
    (node) => node.type === "rule" && node.selector.includes(":focus-visible"),
  );
  assert.ok(generic.length);
  for (const focus of generic) {
    assert.ok(
      !declaration(focus, "background"),
      "Global focus rings must not replace a primary action fill",
    );
    assert.ok(!declaration(focus, "background-color"));
  }
  const menu = read("src/components/ui/dropdown-menu.tsx");
  assert.match(menu, /focus:bg-accent/);
  assert.doesNotMatch(read("src/components/ui/button.tsx"), /focus(?:-visible)?:bg-accent/);
  assert.ok(!read("src/styles.css").includes('@import "./styles/chatgpt-parity.css"'));
  // The contrast treatment stays scoped to the identified primary lightbox action.
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
