import * as publicCatalog from "../../src/lib/public-website-catalog.mjs";
import * as seoPolicy from "../../src/lib/seo-policy.mjs";
import * as appAccess from "../../src/lib/app-access-policy.mjs";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

function fixture(initialPath = "/features") {
  const hooks = createHookHarness();
  let pathname = initialPath;
  const listeners = new Map();
  let focusCount = 0;
  const dependencies = {
    "./public/public-website.css": {},
    "@/lib/public-website-catalog.mjs": publicCatalog,
    "@/lib/seo-policy.mjs": seoPolicy,
    "@/lib/app-access-policy.mjs": appAccess,
    react: { ...hooks.react, useMemo: (factory) => factory() },
    "@tanstack/react-router": {
      Link: "Link",
      useRouterState: ({ select }) => select({ location: { pathname } }),
    },
    "lucide-react": { Menu: "Menu", X: "X" },
    "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
    "@/lib/drawer-navigation-focus": { requestDrawerNavigationFocus: () => true },
  };
  const { PublicFooter } = loadUiModule("src/components/PublicFooter.tsx", dependencies);
  const { PublicHeader } = loadUiModule(
    "src/components/public/PublicShell.tsx",
    {
      ...dependencies,
      "@/components/PublicFooter": { PublicFooter },
      "./MarketingChrome": {
        MarketingHeader: "MarketingHeader",
        MarketingFooter: "MarketingFooter",
      },
      "./public-foundation.css": {},
      "./spec400-public.css": {},
    },
    {
      document: {
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener: (name, handler) => {
          if (listeners.get(name) === handler) listeners.delete(name);
        },
      },
      requestAnimationFrame: (callback) => callback(),
    },
  );
  // Expand only the hook-free local navigation link component, not browser primitives.
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object" || !node.props) return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  return {
    listeners,
    hooks,
    setPath: (value) => {
      pathname = value;
    },
    header: () => expand(hooks.render(PublicHeader)),
    footer: () => expand(hooks.render(PublicFooter)),
    attachToggle: (tree) => {
      const toggle = elements(tree, (node) => node.type === "button")[0];
      toggle.props.ref.current = {
        focus() {
          focusCount++;
        },
      };
      return toggle;
    },
    focusCount: () => focusCount,
  };
}

function includesClasses(node, required) {
  const classes = node.props.className.split(/\s+/);
  for (const token of required) assert.ok(classes.includes(token), `Missing ${token}`);
}

test("public header wraps without losing navigation destinations or bounded controls", () => {
  const f = fixture();
  const tree = f.header();
  includesClasses(tree, [
    "flex",
    "flex-col",
    "max-h-screen",
    "supports-[height:100dvh]:max-h-dvh",
    "min-w-0",
    "[overflow-wrap:anywhere]",
  ]);
  const navigation = elements(tree, (node) => node.props["aria-label"] === "Public navigation")[0];
  includesClasses(navigation, ["flex-wrap", "min-w-0", "w-full", "shrink-0"]);
  const desktop = elements(
    navigation,
    (node) => node.type === "div" && node.props.className?.includes("lg:flex"),
  )[0];
  includesClasses(desktop, ["flex-wrap", "min-w-0", "flex-1"]);
  const links = elements(desktop, (node) => node.type === "Link");
  assert.deepEqual(
    links.map((node) => node.props.to),
    ["/overview", "/features", "/use-cases", "/business", "/pricing", "/download", "/review"],
  );
  for (const link of links) {
    assert.ok(text(link).trim());
    includesClasses(link, ["min-h-11", "min-w-0", "max-w-full", "py-2.5"]);
  }
  const toggle = f.attachToggle(tree);
  assert.equal(toggle.props.variant, "ghost");
  assert.equal(toggle.props.size, "icon");
  includesClasses(toggle, ["ml-auto", "lg:hidden"]);
});

test("mobile public navigation is scrollable and Escape closes it and restores toggle focus", () => {
  const f = fixture();
  const closed = f.header();
  const toggle = f.attachToggle(closed);
  assert.equal(toggle.props["aria-expanded"], false);
  toggle.props.onClick();
  const open = f.header();
  assert.equal(f.attachToggle(open).props["aria-expanded"], true);
  const panel = elements(open, (node) => node.props.id === toggle.props["aria-controls"])[0];
  assert.ok(panel);
  assert.equal(panel.props["aria-label"], "Mobile public navigation");
  includesClasses(panel, ["min-h-0", "overflow-y-auto", "overscroll-contain"]);
  assert.equal(elements(panel, (node) => node.type === "Link").length, 8);
  let prevented = false;
  f.listeners.get("keydown")({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(f.focusCount(), 1);
  assert.equal(
    elements(f.header(), (node) => node.props.id === "public-mobile-navigation").length,
    0,
  );
  assert.equal(f.listeners.has("keydown"), false);
});

test("public navigation closes after route changes and names only the exact current page", () => {
  const f = fixture("/business/enterprise");
  let tree = f.header();
  const business = elements(
    tree,
    (node) => node.type === "Link" && node.props.to === "/business",
  )[0];
  assert.equal(business.props["aria-current"], undefined);
  assert.ok(business.props.className.includes("bg-muted"));
  f.attachToggle(tree).props.onClick();
  f.header();
  f.setPath("/pricing");
  f.header();
  tree = f.header();
  assert.equal(f.attachToggle(tree).props["aria-expanded"], false);
  const current = elements(tree, (node) => node.props["aria-current"] === "page");
  assert.equal(current.length, 1);
  assert.equal(current[0].props.to, "/pricing");
  f.hooks.unmount();
  assert.equal(f.listeners.has("keydown"), false);
});

test("footer columns adapt to available text width while preserving legal and help links", () => {
  const f = fixture("/help");
  const tree = f.footer();
  includesClasses(tree, ["kova-public-footer"]);
  const css = readFileSync("src/components/public/public-website.css", "utf8");
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  const nav = elements(tree, (node) => node.props["aria-label"] === "Footer navigation")[0];
  includesClasses(nav, ["kova-footer-nav"]);
  const links = elements(nav, (node) => node.type === "Link");
  assert.equal(links.length, 60);
  for (const link of links) {
    assert.ok(text(link).trim());
    includesClasses(link, ["min-h-11"]);
  }
  const paths = new Set(links.map((node) => node.props.to));
  for (const required of [
    "/help",
    "/help/contact",
    "/privacy",
    "/terms",
    "/security",
    "/accessibility",
  ]) {
    assert.ok(paths.has(required));
  }
  const current = links.filter((node) => node.props["aria-current"] === "page");
  assert.equal(current.length, 1);
  assert.equal(current[0].props.to, "/help");
});
