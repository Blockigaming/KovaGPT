import test from "node:test";
import assert from "node:assert/strict";
import {
  editorFixture,
  elements,
  classes,
  text,
  generatedCss,
  DocumentPaper,
} from "../helpers/paper-editor-rendered-fixture.mjs";
const content =
  "# Overview\n\nFirst paragraph.\n\n## Details\n\nSecond paragraph.\n\n| Surface | Document behavior |\n| --- | --- |\n| Desktop | Readable ordinary words |\n| Phone | " +
  "long_identifier_".repeat(30) +
  " |";
const cases = [false, true].flatMap((paper) =>
  ["page", "dialog"].map((presentation) => ({
    paper,
    presentation,
    ...editorFixture({ content, paper, presentation, outline: true }),
  })),
);
const css = await generatedCss(cases.map((value) => value.document));
const find = (document, predicate) => {
  const node = elements(document, predicate)[0];
  assert.ok(node);
  return node;
};

test("Paper table gives ordinary column words a real compiled128px minimum while retaining local scrolling and long-token wrap", () => {
  const doc = cases.find((value) => value.paper).document;
  const table = find(doc, (n) => n.name === "table");
  for (const word of ["Surface", "Desktop", "Phone"])
    assert.ok(elements(table, (n) => ["th", "td"].includes(n.name)).some((n) => text(n) === word));
  assert.equal(
    css.declaration("[&_th]:min-w-32", "min-width", " th").value,
    "calc(var(--spacing) * 32)",
  );
  assert.equal(
    css.declaration("[&_td]:min-w-32", "min-width", " td").value,
    "calc(var(--spacing) * 32)",
  );
  assert.equal(css.declaration("[overflow-wrap:anywhere]", "overflow-wrap").value, "anywhere");
  assert.ok(classes(table.parent).includes("overflow-x-auto"));
  assert.ok(classes(table.parent).includes("max-w-full"));
  assert.ok(text(table).includes("long_identifier_".repeat(30)));
});

for (const value of cases)
  test(`${value.presentation} ${value.paper ? "Paper" : "Source"} outline is visible, scrollable, closable and reserves a separate320px editor on phones`, () => {
    const outline = find(value.document, (n) => n.attribs["aria-label"] === "Document outline");
    assert.ok(!classes(outline).includes("hidden"));
    assert.ok(classes(outline).includes("w-full"));
    assert.ok(classes(outline).includes("max-h-60"));
    assert.ok(classes(outline).includes("overflow-y-auto"));
    assert.ok(classes(outline).includes("md:w-56"));
    assert.ok(classes(outline.parent).includes("flex-col"));
    assert.ok(classes(outline.parent).includes("flex-[1_0_auto]"));
    assert.ok(classes(outline.parent).includes("md:flex-row"));
    const region = outline.parent.children
      .filter((n) => n.type === "tag")
      .find((n) => n !== outline);
    assert.ok(classes(region).includes("h-80"));
    assert.ok(classes(region).includes("flex-none"));
    assert.ok(classes(region).includes("md:h-auto"));
    const toggle = find(
      value.document,
      (n) => n.attribs["aria-label"] === "Toggle document outline",
    );
    assert.equal(toggle.attribs["aria-expanded"], "true");
    assert.equal(toggle.attribs["aria-pressed"], "true");
    assert.ok(
      elements(
        outline,
        (n) => n.name === "button" && n.attribs["aria-label"] === "Close document outline",
      ).length,
    );
    const search = find(outline, (n) => n.name === "input");
    assert.ok(Object.hasOwn(search.attribs, "autofocus"));
    assert.equal(css.declaration("flex-[1_0_auto]", "flex").value, "1 0 auto");
    assert.equal(css.declaration("h-80", "height").value, "calc(var(--spacing) * 80)");
    assert.equal(css.declaration("flex-none", "flex").value, "none");
    assert.equal(css.declaration("max-h-60", "max-height").value, "calc(var(--spacing) * 60)");
  });

test("Outline close invokes the guarded focus return and collapses its actual rendered panel", () => {
  const value = editorFixture({ content, outline: true });
  const trigger = value.fixture.find(
    "button",
    (n) => n.props["aria-label"] === "Toggle document outline",
  );
  const target = { synthetic: "outline trigger" };
  trigger.props.ref.current = target;
  value.fixture
    .find("button", (n) => n.props["aria-label"] === "Close document outline")
    .props.onClick();
  value.fixture.render();
  assert.equal(value.focusReturns.length, 1);
  assert.equal(value.focusReturns[0].target, target);
  assert.equal(value.focusReturns[0].url, "http://fixture.invalid/document");
  assert.equal(
    elements(value.renderDocument().document, (n) => n.attribs["aria-label"] === "Document outline")
      .length,
    0,
  );
});

test("Paper heading navigation focuses and reveals the actual rendered Markdown line, never the hidden textarea", () => {
  const value = editorFixture({ content, paper: true, outline: true });
  const calls = [];
  const heading = {
    focus: (options) => calls.push(["focus", options.preventScroll]),
    scrollIntoView: (options) => calls.push(["scroll", options.block]),
  };
  value.fixture.nodes().find((n) => n.type === DocumentPaper).props.containerRef.current = {
    querySelector: (selector) => {
      calls.push(["selector", selector]);
      return heading;
    },
  };
  value.fixture.find("textarea").props.ref.current = {
    focus() {
      throw new Error("Hidden textarea must not receive Paper navigation");
    },
  };
  value.fixture.find("button", (n) => n.props.children === "Details").props.onClick();
  assert.deepEqual(calls, [
    ["selector", '[data-document-line="5"]'],
    ["focus", true],
    ["scroll", "start"],
  ]);
  const renderedHeading = find(value.document, (n) => n.name === "h2" && text(n) === "Details");
  assert.equal(renderedHeading.attribs["data-document-line"], "5");
  assert.equal(renderedHeading.attribs.tabindex, "-1");
});

test("Source heading navigation preserves the existing exact caret offsets", () => {
  const value = editorFixture({ content, outline: true });
  const calls = [];
  value.fixture.find("textarea").props.ref.current = {
    focus: () => calls.push("focus"),
    setSelectionRange: (a, b) => calls.push([a, b]),
  };
  value.fixture.find("button", (n) => n.props.children === "Details").props.onClick();
  const offset = content.indexOf("## Details");
  assert.deepEqual(calls, ["focus", [offset, offset]]);
});
