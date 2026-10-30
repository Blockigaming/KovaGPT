import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/pricing.tsx", "utf8");
const css = readFileSync("src/components/account-surfaces.css", "utf8");
const compiled = ts.transpileModule(source.slice(source.indexOf("function PlanCard(")), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
const PlanCard = new Function("React", "Check", `${compiled}; return PlanCard;`)(React, "check");
const props = {
  name: "Free",
  price: "$0",
  period: "/ month",
  description: "Plan description",
  cta: "Get started",
  features: ["Feature one", "Feature two"],
};
const classes = (node) => node.props.className.split(/\s+/);

const nodes = (value) =>
  value && typeof value === "object"
    ? [value, ...value.children.flat(Infinity).flatMap(nodes)]
    : [];
const contents = (value) =>
  value && typeof value === "object"
    ? value.children.flat(Infinity).map(contents).join("")
    : value == null || typeof value === "boolean"
      ? ""
      : String(value);
const priceRow = (card) =>
  card.children.find((child) => child?.props?.className?.includes("md:min-h-[3.25rem]"));

test("stacked phone cards use natural rows and reserve alignment only from md", () => {
  const card = PlanCard(props);
  assert.ok(classes(card).includes("grid"));
  for (const utility of ["h-full", "grid-rows-subgrid"]) {
    assert.ok(!classes(card).includes(utility));
    assert.ok(classes(card).includes(`md:${utility}`));
  }
  assert.ok(!classes(card).some((value) => /^row-span-/.test(value)));
  assert.ok(classes(card).includes("md:row-span-6"));
  assert.ok(classes(card).includes("rounded-2xl"));
  assert.match(
    css,
    /@media \(max-width: 767px\)\s*\{\s*\.kova-pricing-page \.kova-plan-card\s*\{\s*row-gap: 16px;/,
  );
});

test("plain plan cards retain the plan name, price, features and CTA behavior", () => {
  const onCta = () => {};
  const card = PlanCard({ ...props, highlight: true, ctaDisabled: true, onCta });
  const descendants = nodes(card);
  assert.equal(contents(descendants.find((child) => child.type === "h2")), "Free");
  assert.ok(contents(priceRow(card)).includes("$0"));
  assert.ok(!contents(card).includes("MOST POPULAR"), "Plan choices use plain reference titles");
  const button = descendants.find((child) => child.type === "button");
  assert.equal(button.props.onClick, onCta);
  assert.equal(button.props.disabled, true);
  assert.equal(contents(button), "Get started");
  assert.ok(classes(button).includes("h-11"));
  assert.deepEqual(descendants.filter((child) => child.type === "li").map(contents), [
    "Feature one",
    "Feature two",
  ]);
});

test("shared desktop price rows top-align primary prices regardless of the tax notice", () => {
  const free = priceRow(PlanCard(props));
  const paid = priceRow(PlanCard({ ...props, name: "Plus", price: "$16", taxNotice: true }));
  for (const row of [free, paid]) {
    assert.ok(classes(row).includes("justify-start"));
    assert.ok(!classes(row).includes("justify-end"));
    assert.ok(classes(row).includes("md:min-h-[3.25rem]"));
    assert.ok(!classes(row).some((value) => value.startsWith("min-h-")));
    assert.ok(classes(row.children[0]).includes("items-baseline"));
  }
  assert.equal(free.children[0].children[0].children[0], "$0");
  assert.equal(paid.children[0].children[0].children[0], "$16");
  assert.equal(free.children[1], null, "No empty tax placeholder is added on mobile");
  assert.equal(paid.children[1].children[0], "+ applicable tax");
});

test("Pricing eyebrow retains authored sentence case without forced letter spacing", () => {
  const eyebrow = source.match(/<p className="([^"]+)">\s*Plans and pricing\s*<\/p>/);
  assert.ok(eyebrow, "the existing Plans and pricing copy remains unchanged");
  const tokens = eyebrow[1].split(/\s+/);
  assert.ok(!tokens.includes("uppercase"));
  assert.ok(!tokens.some((token) => token.startsWith("tracking-")));
  assert.ok(tokens.includes("text-sm"));
  assert.ok(tokens.includes("font-semibold"));
});
