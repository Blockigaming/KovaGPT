import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

const { PublicDetailPageView, PublicPageView } = loadUiModule(
  "src/components/public/PublicSite.tsx",
  {
    "@tanstack/react-router": { Link: "Link" },
    "lucide-react": { ArrowRight: "ArrowRight", CheckCircle2: "CheckCircle2" },
    "@/components/public/PublicFaq": { PublicFaq: "PublicFaq" },
    "@/components/public/PublicShell": { PublicShell: "PublicShell" },
  },
);
const { PUBLIC_ACADEMY_PAGES } = loadUiModule("src/lib/public-academy-content.ts", {});
const item = PUBLIC_ACADEMY_PAGES[0];
const detail = PublicDetailPageView({ item });
const classes = (node) => (node.props.className ?? "").split(/\s+/);
const sheet = postcss.parse(readFileSync("src/components/public/spec400-public.css", "utf8"));
const sectionRules = [];
sheet.walkRules((rule) => {
  if (rule.selector.startsWith("[data-public-shell] main > section")) sectionRules.push(rule);
});

// Match only the two direct-child selector shapes in this source contract.
// This validates their exclusions on actual component elements, not browser layout.
function matches(node, compound) {
  const exclusion = compound.match(/:not\(\.([\w-]+)\)$/);
  if (exclusion && classes(node).includes(exclusion[1])) return false;
  const selector = exclusion ? compound.slice(0, exclusion.index) : compound;
  const parts = selector.match(/^(section|div)?(?:\.([\w\\/-]+))?$/);
  assert.ok(parts, `Unsupported selector in this bounded test: ${selector}`);
  return (
    (!parts[1] || node.type === parts[1]) &&
    (!parts[2] || classes(node).includes(parts[2].replaceAll("\\", "")))
  );
}
function paddingRules(section, child) {
  return sectionRules.filter((rule) => {
    const [scope, parent, target] = rule.selector.split(" > ");
    assert.equal(scope, "[data-public-shell] main");
    return matches(section, parent) && matches(child, target);
  });
}

test("Academy highlights grid is exempt from both section-padding rules while rows retain spacing and separators", () => {
  const section = elements(detail, (node) => node.props["aria-label"] === "Page highlights")[0];
  const grid = section.props.children;
  assert.equal(grid.type, "div");
  for (const token of [
    "public-highlights-grid",
    "grid",
    "max-w-7xl",
    "gap-px",
    "bg-border",
    "sm:grid-cols-3",
  ])
    assert.ok(classes(grid).includes(token), token);
  assert.equal(classes(section).includes("bg-muted/25"), true);
  assert.deepEqual(paddingRules(section, grid), []);
  assert.equal(
    classes(grid).some((token) => /^(?:[\w-]+:)?p(?:y|t|b)?-/.test(token)),
    false,
  );
  const rows = grid.props.children;
  assert.equal(rows.length, 3);
  for (const [index, row] of rows.entries()) {
    for (const token of ["min-h-20", "bg-background", "px-4", "py-5", "sm:px-6"])
      assert.ok(classes(row).includes(token), token);
    assert.equal(text(row).trim(), item.highlights[index]);
  }
  assert.equal(
    elements(detail, (node) => classes(node).includes("public-highlights-grid")).length,
    1,
  );
});

test("both existing section rules keep 32px padding for ordinary detail and page sections", () => {
  assert.equal(sectionRules.length, 2);
  for (const rule of sectionRules) {
    assert.match(rule.selector, /:not\(\.public-highlights-grid\)$/);
    assert.equal(rule.nodes.find((node) => node.prop === "padding-block").value, "32px");
  }
  const detailMain = elements(detail, (node) => node.type === "main")[0];
  const hero = detailMain.props.children[0];
  assert.equal(paddingRules(hero, hero.props.children).length, 1);
  const page = PublicPageView({
    eyebrow: "Publishing",
    title: "Title",
    summary: "Summary",
    children: "Content",
  });
  const pageMain = elements(page, (node) => node.type === "main")[0];
  const ordinary = pageMain.props.children[1];
  assert.equal(paddingRules(ordinary, ordinary.props.children).length, 2);
  assert.equal(classes(ordinary.props.children).includes("public-highlights-grid"), false);
});

test("removing the named exemption would reproduce both unwanted grid padding matches", () => {
  const section = elements(detail, (node) => node.props["aria-label"] === "Page highlights")[0];
  const grid = section.props.children;
  const withoutScope = {
    ...grid,
    props: {
      ...grid.props,
      className: classes(grid)
        .filter((name) => name !== "public-highlights-grid")
        .join(" "),
    },
  };
  assert.equal(paddingRules(section, withoutScope).length, 2);
  assert.equal(paddingRules(section, grid).length, 0);
});
