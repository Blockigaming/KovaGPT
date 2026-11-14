import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";
import { PUBLIC_WEBSITE_PAGE_BY_PATH } from "../../src/lib/public-website-catalog.mjs";
const publications = loadUiModule("src/lib/publications.ts", {});
const content = loadUiModule("src/lib/public-content.ts", {});
const icons = Object.fromEntries(
  ["ArrowUpRight", "Code2", "Folder", "Image", "MessageSquare", "Search", "Mic", "ChevronDown"].map(
    (x) => [x, x],
  ),
);
const pageHooks = createHookHarness();
const landing = loadUiModule("src/components/public/MarketingLanding.tsx", {
  react: pageHooks.react,
  "./PricingPlans": { PricingPage: "PricingPage" },
  "lucide-react": icons,
  "./PublicShell": { PublicShell: "PublicShell" },
  "@/lib/publications": publications,
});
test("every main marketing destination renders original content and navigable guide cards", () => {
  const known = new Set([
    "/",
    "/overview",
    "/info",
    "/pricing",
    "/contact-support",
    "/data-controls",
    "/use-cases",
    "/help",
    "/developers/pricing",
    "/developers/console",
    ...PUBLIC_WEBSITE_PAGE_BY_PATH.keys(),
    ...content.PUBLIC_PAGES.map((p) => `/${p.slug}`),
    ...publications.PUBLICATIONS.map((p) => `/${p.section}/${p.slug}`),
  ]);
  for (const page of Object.keys(landing.MARKETING_LANDINGS)) {
    const tree = landing.MarketingLanding({ page });
    assert.equal(elements(tree, (n) => n.type === "main").length, 1);
    assert.equal(elements(tree, (n) => n.type === "h1").length, 1);
    assert.ok(text(tree).length > 200);
    for (const a of elements(tree, (n) => n.type === "a"))
      assert.ok(known.has(a.props.href), `${page}: ${a.props.href}`);
  }
});
test("marketing navigation has six groups, no empty destinations, and a controllable mobile menu", () => {
  const hooks = createHookHarness();
  const { MarketingHeader, MarketingFooter } = loadUiModule(
    "src/components/public/MarketingChrome.tsx",
    { react: hooks.react, "lucide-react": icons },
  );
  let tree = hooks.render(MarketingHeader);
  const toggle = elements(tree, (n) => n.type === "button")[0];
  assert.equal(toggle.props["aria-expanded"], false);
  toggle.props.onClick();
  tree = hooks.render(MarketingHeader);
  assert.equal(
    elements(tree, (n) => n.props.id === "marketing-navigation")[0].props["data-open"],
    true,
  );
  const nav = elements(tree, (n) => n.type === "nav")[0];
  assert.deepEqual(
    elements(nav, (n) => n.type === "summary").map((n) => text(n).trim()),
    ["Products", "Info", "Developer", "Business", "Pricing", "Articles"],
  );
  for (const a of [
    ...elements(tree, (n) => n.type === "a"),
    ...elements(MarketingFooter(), (n) => n.type === "a"),
  ])
    assert.ok(a.props.href && a.props.href !== "#");
  const css = readFileSync("src/components/public/marketing-pages.css", "utf8");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /data-open/);
  assert.match(css, /grid-template-columns: 1fr/);
});
test("news articles use a reading column and retain actual publication paragraphs", () => {
  for (const item of publications.PUBLICATIONS.filter((p) => p.section === "news")) {
    const tree = landing.MarketingPublication({ item });
    assert.equal(elements(tree, (n) => n.type === "article").length, 1);
    for (const paragraph of item.body) assert.ok(text(tree).includes(paragraph));
  }
});

test("header quicklinks resolve to registered routes or authored content", () => {
  const expanded = loadUiModule("src/lib/public-content-expanded.ts", {});
  const docs = loadUiModule("src/lib/developer-docs.ts", {});
  const known = new Set([
    "/info",
    "/news",
    "/contact",
    ...PUBLIC_WEBSITE_PAGE_BY_PATH.keys(),
    ...content.PUBLIC_PAGES.map((p) => `/${p.slug}`),
    ...expanded.EXPANDED_PUBLIC_PAGES.map((p) => `/${p.slug}`),
    ...docs.DEVELOPER_DOCS.map((p) => `/developers/${p.slug}`),
    ...publications.PUBLICATIONS.map((p) => `/${p.section}/${p.slug}`),
  ]);
  for (const name of readdirSync("src/routes")) {
    if (!name.endsWith(".tsx")) continue;
    const source = readFileSync(`src/routes/${name}`, "utf8");
    for (const match of source.matchAll(/createFileRoute\("([^"$]*)"\)/g))
      known.add(match[1].replace(/\/$/, "") || "/");
  }
  const hooks = createHookHarness();
  const { MarketingHeader, MarketingFooter } = loadUiModule(
    "src/components/public/MarketingChrome.tsx",
    { react: hooks.react, "lucide-react": icons },
  );
  for (const a of [
    ...elements(hooks.render(MarketingHeader), (n) => n.type === "a"),
    ...elements(MarketingFooter(), (n) => n.type === "a"),
  ]) {
    if (a.props.href.startsWith("#")) continue;
    assert.ok(known.has(a.props.href), a.props.href);
  }
});
