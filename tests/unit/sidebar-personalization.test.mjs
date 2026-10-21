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
const important = (rule, name) => rule.nodes.findLast((node) => node.prop === name)?.important;

test("shortcut defaults include Scheduled tasks, and choices remain stable after reload", () => {
  const storage = memoryStorage();
  assert.ok(DEFAULT_SIDEBAR_SHORTCUTS.includes("scheduled-tasks"));
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), DEFAULT_SIDEBAR_SHORTCUTS);
  const chosen = ["projects", "work", "scheduled-tasks"];
  assert.equal(saveSidebarShortcuts(storage, "owner", chosen), true);
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), chosen);
  assert.equal(saveSidebarShortcuts(storage, "owner", []), true);
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), []);
});

test("preferences never migrate across accounts or unresolved/guest identities", () => {
  const storage = memoryStorage();
  saveSidebarShortcuts(storage, "account/a", ["work"]);
  saveSidebarShortcuts(storage, "account:b", ["library"]);
  assert.notEqual(sidebarShortcutsKey("account/a"), sidebarShortcutsKey("account:b"));
  assert.deepEqual(readSidebarShortcuts(storage, "account/a"), ["work"]);
  assert.deepEqual(readSidebarShortcuts(storage, "account:b"), ["library"]);
  for (const userId of [undefined, null, ""]) {
    assert.equal(sidebarShortcutsKey(userId), null);
    assert.equal(saveSidebarShortcuts(storage, userId, ["work"]), false);
    assert.equal(resetSidebarShortcuts(storage, userId), false);
    assert.deepEqual(readSidebarShortcuts(storage, userId), DEFAULT_SIDEBAR_SHORTCUTS);
  }
  assert.match(
    source,
    /railPreferences.owner === railOwner \? railPreferences.shortcuts : DEFAULT_SIDEBAR_SHORTCUTS/,
  );
  assert.match(source, /railOwner && railDialogOwner === railOwner/);
});

test("malformed, unknown-version, duplicate, and oversized choices fail back to safe defaults", () => {
  const storage = memoryStorage();
  for (const payload of [
    "{broken",
    JSON.stringify({ version: 2, shortcuts: ["work"] }),
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
  saveSidebarShortcuts(storage, "A", ["work"]);
  saveSidebarShortcuts(storage, "B", ["projects"]);
  assert.equal(resetSidebarShortcuts(storage, "A"), true);
  assert.deepEqual(readSidebarShortcuts(storage, "A"), DEFAULT_SIDEBAR_SHORTCUTS);
  assert.deepEqual(readSidebarShortcuts(storage, "B"), ["projects"]);
  assert.ok(PRINCIPAL_LOCAL_STORAGE_BASES.includes(SIDEBAR_SHORTCUTS_KEY));
  clearPrincipalBrowserStorage("B", { localStorage: storage, sessionStorage: memoryStorage() });
  assert.deepEqual(readSidebarShortcuts(storage, "B"), DEFAULT_SIDEBAR_SHORTCUTS);
  assert.match(source, /isPrincipalBrowserStorageClearedEvent\(event, railOwner\)/);
  assert.match(source, /event.key === sidebarShortcutsKey\(railOwner\)/);
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
  assert.equal(saveSidebarShortcuts(denied, "A", ["work"]), false);
  assert.equal(resetSidebarShortcuts(denied, "A"), false);
  assert.equal(saveSidebarShortcuts(null, "A", ["work"]), false);
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
    rules.some(
      (rule) =>
        rule.selector.includes(".kova-rail-account:focus-visible") && property(rule, "outline"),
    ),
  );
});

test("desktop shares the canvas, while the grey phone drawer uses the bounded shared width", () => {
  const desktop = rules.find(
    (rule) => rule.parent.type === "root" && rule.selector.includes("[data-state]"),
  );
  assert.equal(property(desktop, "background"), "var(--assistant-canvas, var(--background))");
  assert.equal(property(desktop, "border-radius"), "0");
  assert.ok(important(desktop, "background"), "Override the old sidebar parity background");
  assert.equal(property(desktop, "--sidebar-row-height"), "44px");
  const mobile = rules.find(
    (rule) => rule.parent.params === "(max-width: 1023px)" && !rule.selector.startsWith(".dark"),
  );
  for (const name of ["width", "min-width", "max-width"])
    assert.equal(
      property(mobile, name),
      undefined,
      "Refinement must not compete with shared widths",
    );
  const sidebar = ":is(.kova-assistant, .kova-app-shell) .kova-sidebar[data-kova-core-sidebar]";
  const sharedMobile = sharedRules.find(
    (rule) =>
      rule.parent.params === "(max-width: 1023px)" &&
      rule.selectors.some((selector) => selector.replace(/\s+/g, " ").trim() === sidebar) &&
      property(rule, "width"),
  );
  assert.ok(sharedMobile, "The shared sidebar owns the phone width below the desktop breakpoint");
  assert.equal(property(sharedMobile, "width"), "var(--kova-sidebar-drawer-width)");
  assert.equal(tokens.get("--kova-sidebar-drawer-width"), "min(320px, calc(100vw - 24px))");
  assert.equal(property(sharedMobile, "min-width"), "0");
  assert.equal(property(sharedMobile, "max-width"), "calc(100vw - 24px)");
  assert.equal(
    property(mobile, "border-radius"),
    "0 var(--kova-radius-panel) var(--kova-radius-panel) 0",
  );
  assert.equal(tokens.get("--kova-radius-panel"), "24px");
  assert.equal(property(mobile, "background"), "#f3f3f3");
  assert.ok(important(mobile, "background"));
  const darkMobile = rules.find(
    (rule) => rule.parent.params === "(max-width: 1023px)" && rule.selector.startsWith(".dark"),
  );
  assert.equal(property(darkMobile, "background"), "#171717");
  assert.ok(important(darkMobile, "background"));
  assert.ok(
    !rules.some((rule) => rule.selector.includes(".kova-sidebar-scrim")),
    "Refinement must not re-round the full-screen scrim",
  );
});

test("navigation keeps rounded 44px targets and the account outside scrollable shortcuts", () => {
  const railButton = rules.find((rule) => rule.selector.endsWith(".kova-rail-button"));
  assert.equal(property(railButton, "min-width"), "44px");
  assert.equal(property(railButton, "min-height"), "44px");
  assert.equal(
    property(railButton, "border-radius"),
    undefined,
    "Refinement delegates rail shape to the shared owner",
  );
  const scopedRadius = rules.find(
    (rule) =>
      rule.selector.includes(
        "nav.kova-sidebar-rail[data-kova-refined-sidebar][data-kova-core-rail][data-state][aria-label]",
      ) && rule.selector.endsWith(".kova-rail-button[aria-label]"),
  );
  assert.equal(scopedRadius, undefined, "No obsolete local 8px override may mask the shared shape");
  const sharedNavigation = sharedRules.find((rule) => rule.selector.endsWith(".kova-rail-button"));
  assert.ok(sharedNavigation);
  assert.equal(property(sharedNavigation, "border-radius"), "var(--kova-radius-control)");
  assert.equal(tokens.get("--kova-radius-control"), "14px");
  const sharedActions = sharedRules.find((rule) =>
    rule.selector.includes(".kova-rail-button.kova-new-chat, .kova-rail-customize"),
  );
  assert.ok(
    sharedActions,
    "Creation/customization actions retain their distinct pill/circle shape",
  );
  assert.equal(property(sharedActions, "border-radius"), "var(--kova-radius-button)");
  assert.equal(tokens.get("--kova-radius-button"), "9999px");
  const scroll = rules.find((rule) => rule.selector.endsWith(".kova-rail-shortcuts"));
  assert.equal(property(scroll, "overflow-y"), "auto");
  assert.equal(property(scroll, "min-height"), "0");
  const account = rules.find((rule) => rule.selector.endsWith(".kova-rail-account"));
  assert.ok(account);
  assert.match(source, /const canSchedule = signedIn;/);
  assert.match(
    source,
    /canSchedule \? navLink\("\/scheduled-tasks", "Scheduled tasks", TasksGlyph\)/,
  );
  assert.match(source, /shortcut.id !== "maps" \|\| mapsReleaseApproved/);
  assert.ok(SIDEBAR_SHORTCUTS.every((shortcut) => shortcut.to.startsWith("/")));
  assert.match(source, /<NovaLogo decorative/);
});
