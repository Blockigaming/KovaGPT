import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import ts from "typescript";

const require = createRequire(import.meta.url);
const utils = { cn: (...values) => twMerge(clsx(values)) };
function loadComponent(path, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) => dependencies[name] ?? (name === "@/lib/utils" ? utils : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}
const button = loadComponent("src/components/ui/button.tsx");
const { Calendar } = loadComponent("src/components/ui/calendar.tsx", {
  "@/components/ui/button": button,
});
const attribute = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const classes = (tag) => attribute(tag, "class")?.split(/\s+/) ?? [];
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const hasClass = (html, name) => {
  const result = (html.match(/<[^>]+>/g) ?? []).find((tag) => classes(tag).includes(name));
  assert.ok(result, `Missing real Calendar element ${name}`);
  return result;
};
const month = new Date(2026, 9, 1);
const selected = { from: new Date(2026, 9, 12), to: new Date(2026, 9, 16) };
const markup = (props = {}) =>
  renderToStaticMarkup(React.createElement(Calendar, { mode: "range", month, selected, ...props }));

// Real React/DayPicker markup and shared utility contracts. Browser checks are
// still required for measured hit targets, layout containment and interaction.
test("calendar navigation uses ordinary icon targets while the header reserves their space", () => {
  const html = markup();
  for (const name of ["rdp-button_previous", "rdp-button_next"]) {
    const nav = hasClass(html, name);
    for (const token of ["h-11", "w-11", "p-0"]) assert.ok(classes(nav).includes(token), token);
    assert.equal(attribute(nav, "type"), "button");
    assert.ok(attribute(nav, "aria-label"));
    assert.ok(!classes(nav).some((token) => /^(?:h|w)-\(--cell-size\)$/.test(token)));
  }
  const caption = hasClass(html, "rdp-month_caption");
  assert.ok(classes(caption).includes("h-11"));
  assert.ok(classes(caption).includes("px-11"));
});

test("calendar dropdown headers keep the nav height and bounded-month disabled semantics", () => {
  const html = markup({
    captionLayout: "dropdown",
    startMonth: month,
    endMonth: new Date(2027, 9, 1),
  });
  assert.ok(classes(hasClass(html, "rdp-dropdowns")).includes("h-11"));
  const previous = hasClass(html, "rdp-button_previous");
  assert.equal(attribute(previous, "aria-disabled"), "true");
  assert.equal(attribute(previous, "tabindex"), "-1");
  assert.ok(classes(previous).includes("h-11"));
  assert.ok(tags(html, "select").length >= 2, "The actual month/year selectors remain present");
});

test("calendar date cells retain compact sizing and the selected range remains joined", () => {
  const html = markup();
  assert.ok(classes(hasClass(html, "rdp-root")).includes("[--cell-size:2rem]"));
  const days = tags(html, "button").filter((tag) => attribute(tag, "data-day"));
  assert.ok(days.length >= 28);
  for (const day of days) {
    for (const token of ["h-auto", "w-full", "min-w-(--cell-size)"])
      assert.ok(classes(day).includes(token), token);
    assert.ok(!classes(day).includes("h-11"));
    assert.ok(!classes(day).includes("w-11"));
  }
  const middle = days.filter((tag) => attribute(tag, "data-range-middle") === "true");
  assert.equal(middle.length, 3);
  assert.equal(days.filter((tag) => attribute(tag, "data-range-start") === "true").length, 1);
  assert.equal(days.filter((tag) => attribute(tag, "data-range-end") === "true").length, 1);
  for (const day of middle)
    assert.ok(classes(day).includes("data-[range-middle=true]:rounded-none"));
});
