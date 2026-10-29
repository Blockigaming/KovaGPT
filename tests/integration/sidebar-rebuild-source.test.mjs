import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
const scheduled = await readFile("src/lib/scheduled-tasks.functions.ts", "utf8");

test("sidebar preserves the reference navigation hierarchy and canonical routes", () => {
  const ordered = [
    'navLink("/images", "Images", ImagesGlyph)',
    'navLink("/apps", "Connections", PluginsGlyph)',
    'aria-label="Workspace destinations"',
    'navLink("/projects", "Projects", ProjectsGlyph)',
    'navLink("/library", "Library", LibraryGlyph)',
    'navLink("/scheduled-tasks", "Scheduled tasks", TasksGlyph)',
    ">More</span>",
    'navLink("/work", "Work", BriefcaseBusiness)',
    'navLink("/discovery", "Discover", Compass)',
    'navLink("/maps", "Maps", Map)',
    'id="sidebar-pinned-heading"',
    'id="sidebar-chats-heading"',
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = sidebar.indexOf(marker);
    assert.ok(next > cursor, `${marker} must follow the previous sidebar element`);
    cursor = next;
  }
  assert.match(sidebar, /KovaGPT/);
  assert.match(sidebar, /<NovaLogo decorative/);
  assert.match(sidebar, /id="sidebar-pinned-heading"[^>]*>\s*Pinned\s*<\/h2>/);
  assert.match(sidebar, /mapsReleaseApproved \? navLink\("\/maps"/);
  assert.doesNotMatch(sidebar, /research-planner|Deep research|Telescope/);
  assert.doesNotMatch(sidebar, /🖼️|📁|⏰|🧩|❤️|💰/u);
});

test("sidebar interaction and layout contracts are accessible and responsive", () => {
  assert.match(sidebar, /aria-label="Search chats"/);
  assert.match(sidebar, /aria-label="Collapse sidebar"/);
  assert.match(sidebar, /aria-label="Expand sidebar"/);
  assert.match(
    sidebar,
    /<details\s+className="kova-sidebar-more-disclosure"\s+data-ui-reference="gemini-sidebar-disclosure"\s+open=\{isOn\("\/work"\) \|\| isOn\("\/discovery"\) \|\| isOn\("\/maps"\) \|\| undefined\}\s*>/,
  );
  assert.match(sidebar, /<summary className="kova-nav-row cursor-pointer">/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(sidebar, /const EXPANDED_WIDTH = 260/);
  assert.match(sidebarStyles, /--sidebar-row-height: 36px/);
  assert.match(sidebarStyles, /--sidebar-row-height: 44px/);
  assert.match(sidebarStyles, /--sidebar-icon-slot: 20px/);
  assert.match(sidebarStyles, /max\(8px, var\(--safe-bottom, 0px\)\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Scheduled tasks are visible to every signed-in account while data access stays verified", () => {
  assert.match(sidebar, /const canSchedule = signedIn;/);
  assert.match(sidebar, /canSchedule \? navLink\("\/scheduled-tasks"/);
  assert.doesNotMatch(sidebar, /useServerFn\(isScheduledTasksEligible\)/);
  assert.match(scheduled, /await requireVerifiedUser\(request\)/);
  assert.match(scheduled, /scheduled_task_account_available/);
  assert.match(scheduled, /eligible: true/);
  assert.doesNotMatch(
    scheduled,
    /scheduledPlanEligible|requireEligiblePlan|effective_user_plan_tier/,
  );
  assert.match(scheduled, /activeScheduledExecutionReadiness\(\)/);
});
