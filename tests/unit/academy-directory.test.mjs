import * as academyProgress from "../../src/lib/academy-progress.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";

function fixture(query = "") {
  const catalog = loadUiModule("src/lib/public-academy-content.ts", {});
  let search = { q: query, category: "all" };
  const navigations = [];
  const { Route } = loadUiModule("src/routes/academy.tsx", {
    "@/lib/academy-progress.mjs": academyProgress,
    "@tanstack/react-router": {
      Link: "Link",
      createFileRoute: () => (options) => ({
        ...options,
        useSearch: () => search,
        useNavigate: () => (next) => {
          navigations.push(next);
          search = next.search;
        },
      }),
    },
    "lucide-react": { ArrowRight: "ArrowRight" },
    "@/components/public/PublicSite": { PublicPageView: "PublicPageView" },
    "@/lib/public-academy-content": catalog,
  });
  return { Route, navigations, catalog, render: () => Route.component() };
}

test("Academy search reads actual guide content, exposes no-match and clear recovery", () => {
  const f = fixture("institution");
  let tree = f.render();
  const links = elements(tree, (n) => n.type === "Link");
  assert.ok(links.some((n) => n.props.to === "/academy/chatgpt-for-education"));
  assert.ok(links.length < f.catalog.PUBLIC_ACADEMY_PAGES.length);
  elements(tree, (n) => n.type === "input")[0].props.onChange({
    target: { value: "zzzz-no-guide" },
  });
  tree = f.render();
  assert.match(text(tree), /No guides match/);
  assert.equal(elements(tree, (n) => n.type === "Link").length, 0);
  elements(tree, (n) => n.type === "button")[0].props.onClick();
  assert.equal(
    elements(f.render(), (n) => n.type === "Link").length,
    f.catalog.PUBLIC_ACADEMY_PAGES.length,
  );
  assert.equal(f.navigations[0].replace, true);
  assert.equal(f.navigations[0].resetScroll, false);
});

test("Academy query is URL-restorable and rejects non-text or oversized search input", () => {
  const f = fixture();
  assert.equal(f.Route.validateSearch({ q: ["injected"] }).q, "");
  assert.equal(f.Route.validateSearch({ q: "x".repeat(500) }).q.length, 200);
  assert.ok(elements(fixture("education").render(), (n) => n.type === "Link").length > 0);
});
