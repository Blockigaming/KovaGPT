import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

function fixture(initialPath = "/features") {
  const hooks = createHookHarness();
  let pathname = initialPath;
  const listeners = new Map();
  let focusCount = 0;
  const dependencies = {
    react: hooks.react,
    "@tanstack/react-router": {
      Link: "Link",
      useRouterState: ({ select }) => select({ location: { pathname } }),
    },
    "lucide-react": { Menu: "Menu", X: "X" },
    "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
  };
  const { PublicFooter } = loadUiModule("src/components/PublicFooter.tsx", dependencies);
  const { PublicHeader } = loadUiModule(
    "src/components/public/PublicShell.tsx",
    { ...dependencies, "@/components/PublicFooter": { PublicFooter } },
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
    footer: () => expand(PublicFooter()),
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
    ["/features", "/use-cases", "/business", "/developers", "/trust", "/pricing"],
  );
  for (const link of links) {
    assert.ok(text(link).trim());
    includesClasses(link, ["min-h-11", "min-w-0", "max-w-full", "py-2.5"]);
  }
  includesClasses(f.attachToggle(tree), ["h-11", "w-11", "shrink-0"]);
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
  assert.equal(elements(panel, (node) => node.type === "Link").length, 7);
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
  includesClasses(tree, ["min-w-0", "[overflow-wrap:anywhere]"]);
  const layout = elements(tree, (node) => node.props.className?.includes("lg:grid-cols-"))[0];
  includesClasses(layout, ["lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]"]);
  const nav = elements(tree, (node) => node.props["aria-label"] === "Footer navigation")[0];
  includesClasses(nav, ["min-w-0", "grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))]"]);
  const links = elements(nav, (node) => node.type === "Link");
  assert.equal(links.length, 17);
  for (const link of links) {
    assert.ok(text(link).trim());
    includesClasses(link, ["min-h-11", "min-w-0", "max-w-full", "py-2.5"]);
  }
  const paths = new Set(links.map((node) => node.props.to));
  for (const required of [
    "/help",
    "/contact-support",
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
