import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  normalizeSidebarLayout,
  SIDEBAR_ITEMS,
} from "../../src/lib/sidebar-layout.mjs";
import {
  DEFAULT_SIDEBAR_SHORTCUTS,
  readSidebarShortcuts,
  saveSidebarShortcuts,
  SIDEBAR_SHORTCUTS,
  sidebarShortcutsKey,
} from "../../src/lib/sidebar-shortcuts.mjs";

const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");

test("Work cannot be added, displayed or restored as a sidebar item", () => {
  for (const list of [SIDEBAR_ITEMS, SIDEBAR_SHORTCUTS]) {
    assert.equal(
      list.some((item) => item.id === "work" || item.to === "/work"),
      false,
    );
  }
  assert.equal(DEFAULT_SIDEBAR_LAYOUT.shortcuts.includes("work"), false);
  assert.equal(DEFAULT_SIDEBAR_SHORTCUTS.includes("work"), false);
  assert.deepEqual(
    normalizeSidebarLayout({ shortcuts: ["projects", "work", "library"] }).shortcuts,
    ["projects", "library"],
  );
  assert.doesNotMatch(sidebar, /navLink\("\/work"/);
  assert.doesNotMatch(sidebar, /SHORTCUT_ICONS\.work/);
  assert.doesNotMatch(sidebar, /railShortcuts\.includes\("work"\)/);
});

test("old shortcuts preserve other selections but cannot persist Work again", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  storage.setItem(
    sidebarShortcutsKey("owner"),
    JSON.stringify({ version: 1, shortcuts: ["library", "work", "projects"] }),
  );
  assert.deepEqual(readSidebarShortcuts(storage, "owner"), ["library", "projects"]);
  assert.equal(saveSidebarShortcuts(storage, "owner", ["work"]), false);
  assert.equal(saveSidebarShortcuts(storage, "owner", ["library", "projects"]), true);
});
