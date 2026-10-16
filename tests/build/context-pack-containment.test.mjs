import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/";
const css = readFileSync(dir + readdirSync(dir).find((n) => /^styles-.*\.css$/.test(n)), "utf8");
const source = readFileSync("src/routes/context-packs.tsx", "utf8");
const classes = [...source.matchAll(/className="([^"]+)"/g)].map((m) => m[1]);
const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
const pick = (part) => {
  const result = classes.find((s) => s.includes(part));
  assert.ok(result, part);
  return escape(result);
};
for (const width of [320, 390, 834, 1440])
  test(`Context Packs intrinsic containment at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html");
    const main = element("main", pick("kova-workspace-controls"), root);
    const grid = element("div", pick("lg:grid-cols-"), main);
    const builder = element("section", pick("min-w-0 rounded-2xl border p-4"), grid);
    const saved = element("section", "min-w-0", grid);
    for (const n of [main, grid, builder, saved]) assert.equal(c.value(n, "min-width"), "0");
    assert.equal(
      c.value(grid, "grid-template-columns"),
      width < 1024 ? "repeat(1,minmax(0,1fr))" : "minmax(0,1.15fr) minmax(0,.85fr)",
    );
    const list = element("div", pick("max-h-80"), builder);
    assert.equal(c.value(list, "overflow-y"), "auto");
    const row = element("label", pick("flex min-h-12"), list);
    const text = element("span", pick("min-w-0 flex-1"), row);
    const title = element("span", pick("block whitespace-normal"), text);
    const checkbox = element("input", "shrink-0", row, { type: "checkbox" });
    assert.equal(c.value(text, "min-width"), "0");
    assert.equal(c.value(text, "flex"), "1");
    assert.equal(c.value(title, "overflow-wrap"), "anywhere");
    assert.equal(c.value(title, "white-space"), "normal");
    assert.equal(c.value(checkbox, "flex-shrink"), "0");
    assert.ok(["48px", "calc(.25rem * 12)"].includes(c.value(row, "min-height")));
    const savedTitle = element("h3", pick("[overflow-wrap:anywhere] font-medium"), saved);
    assert.equal(c.value(savedTitle, "overflow-wrap"), "anywhere");
    assert.notEqual(c.value(main, "overflow-x"), "hidden");
  });

const timelineSource = readFileSync("src/routes/knowledge-graph.tsx", "utf8");
const timelineClasses = [...timelineSource.matchAll(/className="([^"]+)"/g)].map((m) => m[1]);
const timelinePick = (part) => {
  const result = timelineClasses.find((s) => s.includes(part));
  assert.ok(result, part);
  return escape(result);
};
for (const width of [320, 390, 834, 1440])
  test(`Knowledge Timeline intrinsic containment at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html");
    const main = element("main", timelinePick("kova-workspace-controls"), root);
    const grid = element("div", timelinePick("grid min-w-0 grid-cols-1"), main);
    const list = element("ol", timelinePick("min-w-0 divide-y"), grid);
    const aside = element("aside", timelinePick("min-w-0 rounded-2xl"), grid);
    for (const n of [main, grid, list, aside]) assert.equal(c.value(n, "min-width"), "0");
    assert.equal(
      c.value(grid, "grid-template-columns"),
      width < 1024 ? "repeat(1,minmax(0,1fr))" : "minmax(0,1fr) 18rem",
    );
    const row = element("li", "flex min-h-16 items-center gap-3 p-3", list);
    const content = element("div", "min-w-0 flex-1", row);
    const link = element("a", timelinePick("kova-graph-resource block whitespace-normal"), content);
    assert.equal(c.value(link, "overflow-wrap"), "anywhere");
    assert.equal(c.value(link, "white-space"), "normal");
    if (width < 768) assert.equal(c.value(link, "min-height"), "44px");
    assert.notEqual(c.value(main, "overflow-x"), "hidden");
  });
