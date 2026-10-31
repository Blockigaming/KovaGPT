import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import {
  clearPrincipalBrowserStorage,
  PRINCIPAL_LOCAL_STORAGE_BASES,
} from "../../src/lib/principal-browser-storage.mjs";
import {
  DEFAULT_SIDEBAR_SHORTCUTS,
  readSidebarShortcuts,
  resetSidebarShortcuts,
  saveSidebarShortcuts,
  SIDEBAR_SHORTCUTS,
  SIDEBAR_SHORTCUTS_KEY,
  sidebarShortcutsKey,
} from "../../src/lib/sidebar-shortcuts.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const source = readFileSync("src/components/Sidebar.tsx", "utf8");
const css = postcss.parse(readFileSync("src/styles/sidebar-personalization.css", "utf8"));
const rules = [];
css.walkRules((rule) => rules.push(rule));
const sharedRules = [];
postcss
  .parse(readFileSync("src/styles/sidebar-core.css", "utf8"))
  .walkRules((rule) => sharedRules.push(rule));
const tokens = new Map();
postcss
  .parse(readFileSync("src/styles/visual-tokens.css", "utf8"))
  .walkDecls((decl) => tokens.set(decl.prop, decl.value));
const property = (rule, name) => rule.nodes.findLast((node) => node.prop === name)?.value;

test("shortcut defaults include Scheduled tasks, and choices remain stable after reload", () => {
  const storage = memoryStorage();
  assert.ok(DEFAULT_SIDEBAR_SHORTCUTS.includes("scheduled-tasks"));
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), DEFAULT_SIDEBAR_SHORTCUTS);
  const chosen = ["projects", "images", "scheduled-tasks"];
  assert.equal(saveSidebarShortcuts(storage, "owner", chosen), true);
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), chosen);
  assert.equal(saveSidebarShortcuts(storage, "owner", []), true);
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), []);
});

test("preferences never migrate across accounts or unresolved/guest identities", () => {
  const storage = memoryStorage();
  saveSidebarShortcuts(storage, "account/a", ["images"]);
  saveSidebarShortcuts(storage, "account:b", ["library"]);
  assert.notEqual(sidebarShortcutsKey("account/a"), sidebarShortcutsKey("account:b"));
  assert.deepEqual(readSidebarShortcuts(storage, "account/a"), ["images"]);
  assert.deepEqual(readSidebarShortcuts(storage, "account:b"), ["library"]);
  for (const userId of [undefined, null, ""]) {
    assert.equal(sidebarShortcutsKey(userId), null);
    assert.equal(saveSidebarShortcuts(storage, userId, ["images"]), false);
    assert.equal(resetSidebarShortcuts(storage, userId), false);
    assert.deepEqual(readSidebarShortcuts(storage, userId), DEFAULT_SIDEBAR_SHORTCUTS);
  }
  assert.match(
    source,
    /railPreferences.owner === railOwner \? railPreferences.layout : \{ \.\.\.DEFAULT_SIDEBAR_LAYOUT \}/,
  );
  assert.match(source, /railOwner && railDialogOwner === railOwner/);
});

test("malformed, unknown-version, duplicate, and oversized choices fail back to safe defaults", () => {
  const storage = memoryStorage();
  for (const payload of [
    "{broken",
    JSON.stringify({ version: 2, shortcuts: ["images"] }),
    JSON.stringify({ version: 1, shortcuts: ["work", "work"] }),
    JSON.stringify({ version: 1, shortcuts: ["unknown-route"] }),
    JSON.stringify({ version: 1, shortcuts: "work" }),
    " ".repeat(2049),
  ]) {
    storage.setItem(sidebarShortcutsKey("owner"), payload);
    assert.deepEqual(readSidebarShortcuts(storage, "owner"), DEFAULT_SIDEBAR_SHORTCUTS);
  }
  assert.equal(saveSidebarShortcuts(storage, "owner", ["work", "work"]), false);
  assert.equal(saveSidebarShortcuts(storage, "owner", ["unapproved"]), false);
  const copy = readSidebarShortcuts(storage, "owner");
  copy.pop();
  assert.equal(DEFAULT_SIDEBAR_SHORTCUTS.length, 5);
});

test("reset and account-local clearing remove only the matching account's choices", () => {
  const storage = memoryStorage();
  saveSidebarShortcuts(storage, "A", ["images"]);
  saveSidebarShortcuts(storage, "B", ["projects"]);
  assert.equal(resetSidebarShortcuts(storage, "A"), true);
  assert.deepEqual(readSidebarShortcuts(storage, "A"), DEFAULT_SIDEBAR_SHORTCUTS);
  assert.deepEqual(readSidebarShortcuts(storage, "B"), ["projects"]);
  assert.ok(PRINCIPAL_LOCAL_STORAGE_BASES.includes(SIDEBAR_SHORTCUTS_KEY));
  clearPrincipalBrowserStorage("B", { localStorage: storage, sessionStorage: memoryStorage() });
  assert.deepEqual(readSidebarShortcuts(storage, "B"), DEFAULT_SIDEBAR_SHORTCUTS);
  assert.match(source, /isPrincipalBrowserStorageClearedEvent\(event, railOwner\)/);
  assert.match(source, /event.key === sidebarLayoutKey\(railOwner\)/);
});

test("storage denial is recoverable and the UI reports unsaved choices", () => {
  const denied = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readSidebarShortcuts(denied, "A"), DEFAULT_SIDEBAR_SHORTCUTS);
  assert.equal(saveSidebarShortcuts(denied, "A", ["images"]), false);
  assert.equal(resetSidebarShortcuts(denied, "A"), false);
  assert.equal(saveSidebarShortcuts(null, "A", ["images"]), false);
  assert.match(source, /this browser could not save them/);
  assert.match(source, /role="alert" className="kova-sidebar-personalization-error"/);
});

test("customization uses labeled native controls, modal Escape handling, reset, and visible focus", () => {
  assert.match(source, /aria-label="Customize sidebar"/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-labelledby="sidebar-personalization-title"/);
  assert.match(source, /aria-describedby="sidebar-personalization-description"/);
  assert.match(source, /if \(railDialogOpen && dialog && !dialog.open\) dialog.showModal\(\)/);
  assert.match(
    source,
    /onCancel=\{\(event\) => \{\s*event.preventDefault\(\);\s*closeRailPersonalization\(\)/,
  );
  assert.match(source, /<label key=\{shortcut.id\} className="kova-sidebar-shortcut-choice">/);
  assert.match(source, /checked=\{railShortcuts.includes\(shortcut.id\)\}/);
  assert.match(source, /Reset to default/);
  assert.match(source, /!trigger.closest\("\[inert\]"\)/);
  assert.ok(
    rules.some(
      (rule) =>
        rule.selector.includes(".kova-sidebar-shortcut-choice:focus-within") &&
        property(rule, "outline"),
    ),
  );
  assert.ok(
    sharedRules.some(
      (rule) =>
        rule.selector.includes(".kova-sidebar-rail :is(button, a):focus-visible") &&
        property(rule, "outline"),
    ),
  );
});

test("sidebar colors and bounded drawer width come from one shared owner without important overrides", () => {
  const desktop = sharedRules.find(
    (rule) =>
      rule.parent.type === "root" &&
      rule.selector.includes(".kova-sidebar[data-kova-core-sidebar]") &&
      property(rule, "--sidebar-row-height"),
  );
  assert.equal(property(desktop, "background"), "var(--sidebar)");
  assert.equal(property(desktop, "--sidebar-row-height"), "36px");
  const mobile = sharedRules.find(
    (rule) =>
      rule.parent.params === "(max-width: 1023px)" &&
      rule.selector === ".kova-sidebar[data-kova-core-sidebar]",
  );
  assert.equal(
    property(mobile, "width"),
    "var(--kova-sidebar-drawer-width, min(320px, calc(100vw - 32px)))",
  );
  assert.equal(property(mobile, "min-width"), "0");
  assert.equal(property(mobile, "max-width"), "calc(100vw - 24px)");
  assert.equal(property(mobile, "border-radius"), "0 24px 24px 0");
  assert.equal(tokens.get("--kova-sidebar-width"), "260px");
  assert.equal(tokens.get("--kova-sidebar-rail-width"), "84px");
  assert.equal(tokens.get("--kova-sidebar-drawer-width"), "min(320px, calc(100vw - 32px))");
  assert.ok(
    !rules.some(
      (rule) =>
        rule.selector.includes("[data-kova-core-sidebar]") ||
        rule.selector.includes(".kova-sidebar-rail"),
    ),
    "Dialog customization does not compete with navigation geometry",
  );
  for (const rule of sharedRules)
    for (const node of rule.nodes)
      if (node.type === "decl")
        assert.ok(!node.important, "No sidebar override relies on important specificity");
});

test("navigation keeps dense desktop rows, touch targets and account outside scrollable shortcuts", () => {
  const touch = sharedRules.find(
    (rule) =>
      rule.parent.params === "(pointer: coarse), (max-width: 1023px)" &&
      rule.selector.includes(".kova-sidebar[data-kova-core-sidebar]") &&
      property(rule, "--sidebar-row-height"),
  );
  assert.equal(property(touch, "--sidebar-row-height"), "44px");
  assert.equal(property(touch, "--sidebar-button-size"), "44px");
  const scroll = sharedRules.find((rule) => rule.selector === ".kova-rail-shortcuts");
  assert.equal(property(scroll, "overflow-y"), "auto");
  assert.equal(property(scroll, "min-height"), "0");
  const account = sharedRules.find((rule) => rule.selector === ".kova-rail-account");
  assert.ok(account);
  assert.match(source, /const signedIn = isLoaded && isSignedIn;/);
  assert.match(source, /const availableShortcuts = SIDEBAR_ITEMS.filter/);
  assert.match(source, /shortcut.id !== "maps" \|\| mapsReleaseApproved/);
  assert.ok(SIDEBAR_SHORTCUTS.every((shortcut) => shortcut.to.startsWith("/")));
  assert.match(source, /<NovaLogo decorative/);
});

test("legacy Work choices are dropped without losing other saved destinations", () => {
  const storage = memoryStorage();
  storage.setItem(
    sidebarShortcutsKey("owner"),
    JSON.stringify({ version: 1, shortcuts: ["projects", "work", "library"] }),
  );
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), ["projects", "library"]);
  assert.equal(saveSidebarShortcuts(storage, "owner", ["work"]), false);
});
