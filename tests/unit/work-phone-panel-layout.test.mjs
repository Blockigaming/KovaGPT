import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "@tailwindcss/node";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const source = readFileSync("src/routes/work.tsx", "utf8");
const cardClass = source.match(/<section className="([^"]*flex-col[^"]*bg-card)"/)[1];
const headerClass = source.match(/<header className="([^"]*shrink-0[^"]*border-b p-4)"/)[1];
const bodyClass = source.match(
  /<div data-work-view-scroll className="([^"]*min-h-0 min-w-0 flex-1 overflow-y-auto p-4)"/,
)[1];
const deliverables = source.slice(
  source.indexOf("function Deliverables("),
  source.indexOf("function Approvals("),
);
const gridClass = deliverables.match(/<div className="(grid [^"]+)"/)[1];
const articleClass = deliverables.match(/<article key=\{item.id\} className="([^"]+)"/)[1];
const tokens = [
  ...new Set(
    [
      cardClass,
      headerClass,
      bodyClass,
      gridClass,
      articleClass,
      "work-small shrink-0 whitespace-nowrap!",
      "break-words",
      "break-all",
    ].flatMap((s) => s.split(/\s+/)),
  ),
];
const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
  base: `${process.cwd()}/src`,
  onDependency() {},
});
const css = compiler.build(tokens);
const escape = (s) =>
  s
    .split(/\s+/)
    .map((p) => p.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const [width, height] of [
  [320, 844],
  [390, 844],
  [844, 390],
  [834, 1112],
  [1440, 900],
]) {
  test(`Actual Work card uses the remaining space after a wrapped header at ${width}×${height}`, () => {
    const c = compiledCascade(css, width, width < 768);
    const main = element("main", "kova-adapted-controls", element("html"));
    const card = element("section", escape(cardClass), main);
    const header = element("header", escape(headerClass), card);
    const body = element("div", escape(bodyClass), card);
    assert.equal(c.value(card, "display"), "flex");
    assert.equal(c.value(card, "flex-direction"), "column");
    assert.match(c.value(card, "min-height"), /^0(?:px)?$/);
    assert.equal(c.value(header, "flex-shrink"), "0");
    assert.equal(c.value(body, "flex"), "1");
    assert.match(c.value(body, "min-height"), /^0(?:px)?$/);
    assert.equal(c.value(body, "overflow-y"), "auto");
    assert.equal(c.value(body, "height"), undefined);
    assert.doesNotMatch(source, /h-\[calc\(100%-10\.5rem\)\]/);
    const grid = element("div", escape(gridClass), body);
    const article = element("article", escape(articleClass), grid);
    assert.equal(
      c.value(grid, "grid-template-columns"),
      `repeat(${width < 1024 ? 1 : 2}, minmax(0, 1fr))`,
    );
    assert.match(c.value(grid, "min-width"), /^0(?:px)?$/);
    assert.match(c.value(article, "min-width"), /^0(?:px)?$/);
    assert.equal(
      c.value(
        element("button", escape("work-small shrink-0 whitespace-nowrap!"), article),
        "white-space",
      ),
      "nowrap",
    );
  });
}
test("Long deliverable labels remain readable and actions wrap inside their card", () => {
  assert.match(deliverables, /className="break-words font-medium">\{item.title\}/);
  assert.match(deliverables, /className="mt-1 break-all font-mono/);
  assert.match(deliverables, /className="mt-3 flex flex-wrap gap-2"/);
  assert.match(deliverables, /className="flex min-w-0 flex-1 flex-wrap gap-2"/);
  assert.match(deliverables, /<Download \/>\s*Download/);
  assert.doesNotMatch(deliverables, /overflow-hidden|truncate/);
});

test("Evidence filters bound their intrinsic widths and wrap instead of overrunning the tablet gutter", () => {
  const evidence = source.slice(
    source.indexOf("function Evidence("),
    source.indexOf("function Deliverables("),
  );
  assert.match(evidence, /flex min-w-0 max-w-full flex-1 flex-wrap gap-2/);
  assert.match(evidence, /relative min-w-0 max-w-full flex-\[1_1_12rem\]/);
  assert.equal((evidence.match(/min-h-10 min-w-0 max-w-full flex-\[1_1_9rem\]/g) ?? []).length, 2);
  assert.match(evidence, /min-h-10 w-full min-w-0 rounded-xl border pl-9 pr-3/);
  assert.doesNotMatch(evidence, /overflow-hidden[^]*Search evidence/);
});

test("Version history keeps Restore intact and lets a long title wrap before the action", () => {
  const history = deliverables.slice(deliverables.indexOf("{history && ("));
  assert.match(history, /flex flex-wrap items-start justify-between gap-2/);
  assert.match(history, /min-w-0 flex-\[1_1_12rem\]/);
  assert.match(history, /break-words font-medium/);
  assert.match(history, /className="work-small shrink-0 whitespace-nowrap!"[^]*?Restore/);
});
