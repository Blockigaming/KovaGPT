import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

function fixture({ query = "", recent = [], pinned = [] } = {}) {
  const hooks = createHookHarness();
  const actions = [];
  const values = new Map([
    ["kova-command-history-v1", JSON.stringify(recent)],
    ["kova-command-pins-v1", JSON.stringify(pinned)],
  ]);
  const module = loadUiModule(
    "src/components/CommandPalette.tsx",
    {
      react: { ...hooks.react, useDeferredValue: (value) => value, useMemo: (fn) => fn() },
      "@tanstack/react-router": { Link: "Link" },
      "lucide-react": Object.fromEntries(
        [
          "Search",
          "SquarePen",
          "Settings",
          "Image",
          "FolderOpen",
          "Calendar",
          "X",
          "FlaskConical",
          "ShieldCheck",
          "SunMoon",
          "FileSearch",
          "Boxes",
          "Star",
          "Zap",
        ].map((name) => [name, name]),
      ),
      "@/platform/capabilities": { CAPABILITIES: [] },
      "@/platform/extensions": { extensionRegistry: { contributions: () => [] } },
      "@/platform/events": { platformEvents: { publish: () => {} } },
      "@/lib/theme": { applyThemeMode: () => actions.push("theme") },
      "@/lib/conversation-search": { searchConversations: () => [] },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, user: { id: "fixture-owner" } }),
      },
      "@/lib/principal-browser-storage.mjs": {
        browserStoragePrincipal: () => "fixture-owner",
        isPrincipalBrowserStorageClearedEvent: () => false,
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "fixture-clear",
        principalScopedStorageKey: (base) => base,
        safeBrowserStorage: () => ({
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
        }),
      },
    },
    {
      document: {
        activeElement: null,
        getElementById: () => null,
        querySelectorAll: () => [],
        documentElement: { classList: { contains: () => false } },
      },
      HTMLElement: class {},
      window: {
        requestAnimationFrame: (fn) => {
          fn();
          return 1;
        },
        cancelAnimationFrame: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: (fn) => {
          fn();
          return 1;
        },
        location: { assign: (href) => actions.push(href) },
      },
      queueMicrotask: (fn) => fn(),
    },
  );
  const props = {
    open: true,
    query,
    onQueryChange: () => {},
    conversations: [],
    archivedConversations: [],
    workspaceItems: [],
    onClose: () => actions.push("close"),
    onNewChat: () => actions.push("new-chat"),
    onSelectChat: () => actions.push("chat"),
    onSelectArchived: () => actions.push("archive"),
    onOpenSettings: () => actions.push("settings"),
  };
  const render = () => hooks.render(module.CommandPalette, props);
  render();
  const tree = render();
  const input = elements(tree, (node) => node.type === "input")[0];
  const inputTarget = { focus() {} };
  input.props.ref.current = inputTarget;
  return {
    actions,
    tree,
    render,
    inputTarget,
    key(key, target = inputTarget, nativeEvent = {}) {
      let prevented = false;
      tree.props.onKeyDown({
        key,
        target,
        nativeEvent,
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

test("Enter on a tab-focused button retains its native action instead of executing the active result", () => {
  const f = fixture();
  assert.equal(f.key("Enter", { tagName: "BUTTON" }), false);
  assert.deepEqual(f.actions, []);
  const close = elements(f.tree, (node) => node.props["aria-label"] === "Close command palette")[0];
  close.props.onClick();
  assert.deepEqual(f.actions, ["close"]);
});

test("IME composition and keyCode 229 cannot execute or close the palette", () => {
  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
    const f = fixture();
    for (const key of ["Enter", "Escape", "ArrowDown", "ArrowUp"]) {
      assert.equal(f.key(key, f.inputTarget, nativeEvent), false);
    }
    assert.deepEqual(f.actions, []);
  }
});

test("normal combobox Enter and Escape retain their original command behavior", () => {
  const enter = fixture();
  assert.equal(enter.key("Enter"), true);
  assert.deepEqual(enter.actions, ["new-chat", "close"]);
  const escape = fixture();
  assert.equal(escape.key("Escape", { tagName: "BUTTON" }), true);
  assert.deepEqual(escape.actions, ["close"]);
});

test("history and pins only rank matching commands and cannot defeat the query filter", () => {
  const f = fixture({ query: "zzzz-unmatched-command", recent: ["/images"], pinned: ["/library"] });
  const labels = elements(f.tree, (node) => node.props.role === "option").map(text);
  assert.equal(
    labels.some((label) => label.includes("Generate image")),
    false,
  );
  assert.equal(
    labels.some((label) => label.includes("Open Library")),
    false,
  );
  const matching = fixture({ query: "library", pinned: ["/library"] });
  assert.ok(
    elements(matching.tree, (node) => node.props.role === "option").some((node) =>
      text(node).includes("Open Library"),
    ),
  );
});

test("the real guest palette fixture runs on all three engines without production auth", () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const config = read("playwright.ui-foundations.config.ts");
  const workflow = read(".github/workflows/ui-foundation-browser.yml");
  const vite = read("tests/ui-foundations/vite.config.ts");
  const auth = read("tests/ui-foundations/fixture/auth.ts");
  for (const engine of ["chromium", "firefox", "webkit"])
    assert.ok(config.includes(`browserName: "${engine}"`));
  assert.match(workflow, /browser: \[chromium, firefox, webkit\]/);
  assert.match(config, /retries: 0/);
  assert.match(vite, /find: "@\/components\/auth\/ClerkSafe"/);
  assert.match(vite, /envDir: false/);
  assert.match(auth, /user: null/);
  assert.doesNotMatch(auth, /^\s*import\b|\b(?:import|fetch)\s*\(/m);
});
