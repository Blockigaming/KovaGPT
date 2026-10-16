import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { compile } from "@tailwindcss/node";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
import { editorFixture, elements } from "../helpers/paper-editor-rendered-fixture.mjs";
const { document } = editorFixture({
  content:
    "# Heading\n\n[Safe link](https://example.invalid)\n\n| Surface | Purpose |\n| --- | --- |\n| Phone | Readable |",
  paper: true,
});
const paperNode = elements(document, (n) => n.attribs["aria-label"] === "Document paper view")[0];
assert.ok(paperNode);
const className = paperNode.attribs.class;
const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
  base: `${process.cwd()}/src`,
  onDependency() {},
});
const compiled = compiler.build(className.split(/\s+/));
// The bounded cascade helper has no pseudo-state engine. Replacing this selector
// with a same-specificity fixture attribute models only the explicitly focused
// test elements; this is compiled CSS evidence, not a browser focus measurement.
const ast = postcss.parse(compiled);
ast.walkRules((rule) => {
  rule.selector = rule.selector.replace(/:focus-visible\b/g, "[data-test-focus-visible]");
});
const css = ast.toString();
const escape = (s) =>
  s
    .split(/\s+/)
    .map((p) => p.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [320, 390, 834, 1440])
  for (const dark of [false, true])
    test(`Paper focus stays dark against white without altering surrounding ${dark ? "Dark" : "Light"} theme at ${width}px`, () => {
      const c = compiledCascade(css, width, width < 768);
      const html = element("html", dark ? "dark" : "");
      const outside = element("button", "", html, { "data-test-focus-visible": "" });
      const baseline = element("div", escape(className.replace("[--ring:#171717]", "")), html);
      const paper = element("div", escape(className), html);
      assert.equal(
        c.value(baseline, "--ring"),
        c.value(outside, "--ring"),
        "Reproduces the inherited app-theme ring on the old white surface",
      );
      assert.notEqual(c.value(outside, "--ring"), "#171717");
      assert.equal(c.value(paper, "--ring"), "#171717");
      assert.equal(c.value(paper, "background-color"), "#fff");
      assert.equal(c.value(paper, "color-scheme"), "light");
      for (const [tag, attrs] of [
        ["h1", { tabindex: "-1", "data-document-line": "1" }],
        ["div", { tabindex: "0", role: "region", "aria-label": "Scrollable table" }],
        ["a", { href: "https://example.invalid" }],
      ]) {
        const target = element(tag, "", paper, { ...attrs, "data-test-focus-visible": "" });
        const before = element(tag, "", baseline, { ...attrs, "data-test-focus-visible": "" });
        assert.equal(c.value(target, "outline"), "2px solid #171717");
        assert.equal(c.value(target, "outline-offset"), "2px");
        assert.notEqual(c.value(before, "outline"), c.value(target, "outline"));
        assert.equal(
          c.winner(target, "outline").score[0],
          1,
          "Existing important accessible outline rule remains active",
        );
      }
    });
test("The chosen Paper-only neutral has more than 17:1 contrast on white", () => {
  const channel = 23 / 255;
  const luminance = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const ratio = 1.05 / (luminance + 0.05);
  assert.ok(ratio > 17);
  assert.ok(className.includes("[--ring:#171717]"));
});
test(
  "Focus token is the only product delta and rendered heading/table semantics are retained",
  { skip: !process.env.KOVA_PAPER_FOCUS_BASE_SOURCE },
  () => {
    const current = readFileSync("src/components/DocumentPaper.tsx", "utf8");
    const base = readFileSync(process.env.KOVA_PAPER_FOCUS_BASE_SOURCE, "utf8");
    assert.equal(current.replace(" [--ring:#171717]", ""), base);
    assert.ok(
      elements(
        paperNode,
        (n) =>
          n.name === "h1" && n.attribs["data-document-line"] === "1" && n.attribs.tabindex === "-1",
      ).length,
    );
    assert.ok(
      elements(
        paperNode,
        (n) => n.attribs["aria-label"] === "Scrollable table" && n.attribs.tabindex === "0",
      ).length,
    );
  },
);
