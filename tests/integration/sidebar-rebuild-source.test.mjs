import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const scheduled = await readFile("src/lib/scheduled-tasks.functions.ts", "utf8");

test("sidebar preserves the reference navigation hierarchy and canonical routes", () => {
  const ordered = [
    'navLink("/images", "Images", Images)',
    'navLink("/library", "Library", LibraryBig)',
    'navLink("/projects", "Projects", Folder)',
    'navLink("/scheduled-tasks", "Scheduled tasks", Clock3)',
    'navLink("/apps", "Connections", Puzzle)',
    ">Chats</h2>",
    "pinned.map(chatRow)",
    "recents.map(chatRow)",
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = sidebar.indexOf(marker);
    assert.ok(next > cursor, `${marker} must follow the previous sidebar element`);
    cursor = next;
  }
  assert.match(sidebar, /KovaGPT/);
  assert.doesNotMatch(sidebar, /navLink\("\/files"/);
  assert.doesNotMatch(sidebar, /Health is coming soon|Finances is coming soon|navLink\("\/work"/);
  assert.doesNotMatch(sidebar, /research-planner|Deep research|Telescope/);
  assert.doesNotMatch(sidebar, /🖼️|📁|⏰|🧩|❤️|💰/u);
});

test("sidebar interaction and layout contracts are accessible and responsive", () => {
  assert.match(sidebar, /aria-label="Search chats"/);
  assert.match(sidebar, /aria-label="Collapse sidebar"/);
  assert.match(sidebar, /aria-label="Expand sidebar"/);
  assert.match(sidebar, /aria-hidden=\{collapsed/);
  assert.match(sidebar, /inert=\{collapsed/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(styles, /--sidebar-row-height: 3\.5rem/);
  assert.match(styles, /--sidebar-icon-slot: 1\.75rem/);
  assert.match(styles, /max\(0\.8rem, var\(--safe-bottom\)\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Scheduled navigation stays discoverable while data access enforces server eligibility", () => {
  assert.doesNotMatch(sidebar, /useServerFn\(isScheduledTasksEligible\)/);
  assert.match(sidebar, /signedIn[\s\S]{0,80}navLink\("\/scheduled-tasks"/);
  assert.match(scheduled, /function scheduledPlanEligible\(tier: unknown\)/);
  assert.match(scheduled, /tier !== "free"/);
  assert.match(scheduled, /if \(requireEligiblePlan\)/);
  assert.match(scheduled, /throw safeTaskError\(plan\.error\?\.code, "task_plan_required"\)/);
});
