import {
  SIDEBAR_ITEMS as catalog,
  DEFAULT_SIDEBAR_LAYOUT as defaultLayout,
} from "../../src/lib/sidebar-layout.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
const scheduled = await readFile("src/lib/scheduled-tasks.functions.ts", "utf8");

test("sidebar catalog preserves requested destinations and customizable order", () => {
  for (const [id, to] of [
    ["images", "/images"],
    ["library", "/library"],
    ["projects", "/projects"],
    ["scheduled-tasks", "/scheduled-tasks"],
    ["apps", "/apps"],
  ]) {
    assert.ok(catalog.some((item) => item.id === id && item.to === to));
    assert.ok(defaultLayout.shortcuts.includes(id));
  }
  assert.ok(!catalog.some((item) => item.to === "/work"));
  assert.match(sidebar, /navLink\(item.to, item.label, SHORTCUT_ICONS\[id\]\)/);
  assert.match(sidebar, /<NovaLogo decorative/);
  assert.match(sidebar, /id="sidebar-pinned-heading"[^>]*>\s*Pinned\s*<\/h2>/);
  assert.match(sidebar, /mapsReleaseApproved && railShortcuts.includes\("maps"\)/);
  assert.doesNotMatch(sidebar, /🖼️|📁|⏰|🧩|❤️|💰/u);
});

test("sidebar interaction and layout contracts are accessible and responsive", () => {
  for (const name of ["Search chats", "Collapse sidebar", "Resize sidebar"])
    assert.ok(sidebar.includes('aria-label="' + name + '"'));
  assert.match(sidebar, /Expand sidebar/);
  assert.match(sidebar, /kova-sidebar-more-disclosure/);
  assert.match(sidebar, /<summary className="kova-nav-row cursor-pointer">/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.equal(defaultLayout.width, 280);
  assert.match(sidebar, /"--sidebar-expanded": `\$\{layout.width\}px`/);
  assert.match(sidebarStyles, /--sidebar-row-height: 36px/);
  assert.match(sidebarStyles, /--sidebar-row-height: 44px/);
  assert.match(sidebarStyles, /--sidebar-icon-slot: 20px/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Scheduled tasks are visible to every signed-in account while data access stays verified", () => {
  assert.ok(catalog.some((item) => item.to === "/scheduled-tasks"));
  assert.ok(defaultLayout.shortcuts.includes("scheduled-tasks"));
  assert.doesNotMatch(sidebar, /useServerFn\(isScheduledTasksEligible\)/);
  assert.match(scheduled, /await requireVerifiedUser\(request\)/);
  assert.match(scheduled, /scheduled_task_account_available/);
  assert.match(scheduled, /eligible: true/);
  assert.match(scheduled, /activeScheduledExecutionReadiness\(\)/);
});
