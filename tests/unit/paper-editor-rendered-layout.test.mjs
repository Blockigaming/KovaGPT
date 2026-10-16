import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDocument } from "htmlparser2";
import {
  DocumentPaper,
  editorFixture,
  elements,
  classes,
  text,
  generatedCss,
} from "../helpers/paper-editor-rendered-fixture.mjs";

const identifier = "synthetic_document_identifier_".repeat(12);
const content = `# Main heading

## Section heading

### Detail heading

Paragraph **bold** and *emphasis* with \`inline code\` and ${identifier}.

1. First step
2. Second step

- Parent bullet
  - Nested bullet

> Readable quotation

\`\`\`js
const untouched = '<safe>';
    indented();
\`\`\`

| Surface | Purpose |
| --- | --- |
| Phone | Readable table cells |

[Safe link](https://example.test/docs?q=1#part)

[Unsafe link](javascript:alert%281%29)

<script>alert(1)</script>

![Tracking image](https://example.test/pixel)`;

const rendered = {};
for (const presentation of ["page", "dialog"])
  for (const paper of [false, true])
    rendered[`${presentation}-${paper}`] = editorFixture({ content, presentation, paper });
const css = await generatedCss(Object.values(rendered).map((fixture) => fixture.document));
const find = (root, predicate) => {
  const node = elements(root, predicate)[0];
  assert.ok(node, "Expected rendered element");
  return node;
};

test("real Markdown rendering retains semantic hierarchy, markers, safe links and contained tables", () => {
  const { document, html } = rendered["page-true"];
  const paper = find(document, (node) => node.attribs["aria-label"] === "Document paper view");
  assert.equal(paper.attribs.hidden, undefined);
  for (const tag of [
    "h1",
    "h2",
    "h3",
    "ol",
    "ul",
    "li",
    "strong",
    "em",
    "code",
    "pre",
    "blockquote",
    "th",
    "td",
  ])
    assert.ok(elements(paper, (node) => node.name === tag).length, tag);
  const list = find(paper, (node) => node.name === "ul");
  assert.ok(
    elements(list, (node) => node.name === "ul").length > 1,
    "Nested bullets remain nested",
  );
  const table = find(paper, (node) => node.name === "table");
  assert.equal(table.parent.attribs.role, "region");
  assert.equal(table.parent.attribs["aria-label"], "Scrollable table");
  assert.equal(table.parent.attribs.tabindex, "0");
  assert.ok(classes(table.parent).includes("overflow-x-auto"));
  assert.equal(
    find(paper, (node) => node.name === "a").attribs.href,
    "https://example.test/docs?q=1#part",
  );
  assert.equal(
    elements(paper, (node) => ["script", "img", "iframe"].includes(node.name)).length,
    0,
  );
  assert.doesNotMatch(html, /href="(?:javascript:|data:)/);
  assert.ok(text(paper).includes(identifier));
  assert.ok(text(paper).includes("    indented();"));
  assert.ok(text(paper).includes("Image reference: Tracking image"));
});

test("rendered typography has real compiled CSS, without depending on a prose plugin", () => {
  for (const [token, property, expected, suffix = ""] of [
    ["[&_h1]:text-3xl", "font-size", "var(--text-3xl)", " h1"],
    ["[&_h2]:text-2xl", "font-size", "var(--text-2xl)", " h2"],
    ["[&_h3]:text-xl", "font-size", "var(--text-xl)", " h3"],
    ["[&_p]:my-4", "margin-block", "calc(var(--spacing) * 4)", " p"],
    ["[&_ul]:list-disc", "list-style-type", "disc", " ul"],
    ["[&_ol]:list-decimal", "list-style-type", "decimal", " ol"],
    ["[&_ul]:pl-6", "padding-left", "calc(var(--spacing) * 6)", " ul"],
    ["[&_td]:px-3", "padding-inline", "calc(var(--spacing) * 3)", " td"],
    ["[&_td]:py-2", "padding-block", "calc(var(--spacing) * 2)", " td"],
    ["[&_th]:px-3", "padding-inline", "calc(var(--spacing) * 3)", " th"],
    ["[&_pre]:whitespace-pre-wrap", "white-space", "pre-wrap", " pre"],
    ["[overflow-wrap:anywhere]", "overflow-wrap", "anywhere"],
    ["overflow-x-auto", "overflow-x", "auto"],
    ["[color-scheme:light]", "color-scheme", "light"],
    ["bg-white", "background-color", "var(--color-white)"],
    ["text-black", "color", "var(--color-black)"],
  ]) {
    const declaration = css.declaration(token, property, suffix);
    assert.equal(declaration.value, expected, token);
    assert.deepEqual(declaration.media, [], `${token} applies in both themes and all widths`);
  }
  assert.match(css.declaration("font-sans", "font-family").value, /Kova DM Sans/);
});

for (const presentation of ["page", "dialog"])
  for (const paper of [false, true])
    test(`${presentation} ${paper ? "Paper" : "Source"} keeps chrome and footer in normal flow around the editing region`, () => {
      const { document } = rendered[`${presentation}-${paper}`];
      const surface = find(document, (node) =>
        presentation === "page"
          ? node.attribs.role === "main"
          : classes(node).includes("kova-artifact-dialog"),
      );
      assert.ok(classes(surface).includes("overflow-y-auto"));
      assert.ok(classes(surface).includes("md:overflow-hidden"));
      const title = find(
        surface,
        (node) => node.attribs["aria-label"] === "Document title and formatting",
      );
      const region = find(surface, (node) => classes(node).includes("flex-[1_0_20rem]"));
      const footer = find(surface, (node) => classes(node).includes("kova-artifact-footer"));
      assert.equal(title.parent, surface);
      assert.equal(region.parent, surface);
      assert.equal(footer.parent, surface);
      assert.ok(surface.children.indexOf(title) < surface.children.indexOf(region));
      assert.ok(surface.children.indexOf(region) < surface.children.indexOf(footer));
      for (const node of [title, footer]) assert.ok(classes(node).includes("shrink-0"));
      for (const node of [title, region, footer])
        assert.ok(
          !classes(node).some((token) => ["absolute", "fixed", "sticky", "hidden"].includes(token)),
        );
      for (const label of [
        "Copy original",
        "Copy edited",
        "Export draft",
        "Save to Library",
        "Open in Work",
        "Ask Kova",
        "Add to Context Pack",
        "Close",
      ])
        assert.ok(
          elements(footer, (node) => node.name === "button").some(
            (node) => text(node).trim() === label,
          ),
          label,
        );
      const textarea = find(region, (node) => node.name === "textarea");
      assert.equal(text(textarea), content);
      assert.equal(Object.hasOwn(textarea.parent.attribs, "hidden"), paper);
      assert.equal(classes(textarea.parent).includes("hidden"), paper);
      const renderedPaper = find(
        region,
        (node) => node.attribs["aria-label"] === "Document paper view",
      );
      assert.equal(Object.hasOwn(renderedPaper.attribs, "hidden"), !paper);
      assert.ok(classes(renderedPaper).includes("min-h-0"));
      assert.ok(classes(renderedPaper).includes("flex-1"));
    });

test("generated narrow-width layout reserves 20rem and removes footer clipping without changing desktop flex sizing", () => {
  assert.equal(css.declaration("flex-[1_0_20rem]", "flex").value, "1 0 20rem");
  assert.equal(css.declaration("min-h-80", "min-height").value, "calc(var(--spacing) * 80)");
  assert.equal(css.declaration("overflow-y-auto", "overflow-y").value, "auto");
  assert.equal(css.declaration("shrink-0", "flex-shrink").value, "0");
  for (const [token, property, expected] of [
    ["max-md:max-h-none!", "max-height", "none"],
    ["max-md:overflow-visible!", "overflow", "visible"],
  ]) {
    const declaration = css.declaration(token, property);
    assert.equal(declaration.value, expected);
    assert.equal(declaration.important, true, "Must override the existing unlayered footer cap");
    assert.deepEqual(declaration.media, ["(width < 48rem)"]);
  }
  for (const [token, property, expected] of [
    ["md:flex-1", "flex", "1"],
    ["md:min-h-0", "min-height", "0px"],
    ["md:overflow-hidden", "overflow", "hidden"],
  ]) {
    const declaration = css.declaration(token, property);
    assert.equal(declaration.value, expected);
    assert.deepEqual(declaration.media, ["(width >= 48rem)"]);
  }
});

test("paper's existing character limit still refuses oversized rendering", () => {
  const html = renderToStaticMarkup(
    React.createElement(DocumentPaper, {
      title: "Oversized",
      content: "x".repeat(200001),
      containerRef: { current: null },
      visible: true,
    }),
  );
  const document = parseDocument(html);
  assert.ok(elements(document, (node) => node.attribs.role === "alert").length);
  assert.equal(
    elements(document, (node) => node.attribs["aria-label"] === "Document paper view").length,
    0,
  );
});
