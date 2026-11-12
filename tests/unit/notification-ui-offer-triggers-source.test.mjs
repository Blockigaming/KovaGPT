import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFICATION_IDS, notificationDefinition } from "../../src/lib/notification-catalog.mjs";
const source = (file) => readFileSync(file, "utf8");
test("shared notice UI has responsive themed desktop and mobile geometry", () => {
  const css = source("src/components/kova-notification-surface.css");
  const ui = source("src/components/KovaNotificationPanel.tsx");
  assert.match(css, /width: min\(460px, 100%\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /var\(--popover\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const value of [
    "kova-notice-symbol",
    "kova-notice-actions",
    "data-visual={visual}",
    "aria-modal={nonBlocking ? undefined : true}",
    "focus-visible",
  ]) {
    assert.ok((css + "\n" + ui).includes(value), value);
  }
});
test("toasts avoid composer controls in short viewports and limit stacking", () => {
  const ui = source("src/components/ui/sonner.tsx");
  assert.match(ui, /shortViewport \? "top-center" : mobile \? "bottom-center" : "bottom-right"/);
  assert.match(ui, /visibleToasts=\{shortViewport \? 1 : mobile \? 2 : 3\}/);
  assert.match(ui, /max-height: 560px/);
  assert.match(ui, /safe-area-inset-bottom/);
  assert.match(ui, /ResizeObserver/);
  assert.match(ui, /window\.innerHeight - rect\.top \+ 12/);
});
test("offer never displays solely on free plan", () => {
  const offer = source("src/components/FreeOfferButton.tsx");
  const sidebar = source("src/components/Sidebar.tsx");
  assert.match(offer, /getFreeOfferEligibility/);
  assert.match(offer, /!offer\.eligible/);
  assert.match(offer, /variant === "sidebar"/);
  assert.match(sidebar, /FreeOfferButton variant="sidebar"/);
});
test("server-recorded source events are distinct from speculative screen state", () => {
  const image = source("src/routes/images.tsx");
  const chat = source("src/routes/index.tsx");
  const tasks = source("src/routes/scheduled-tasks.tsx");
  assert.match(image, /image_edit_started/);
  assert.match(image, /quotaNoticeShown/);
  assert.match(chat, /delta\?\.kind === "web_sources"/);
  assert.match(chat, /search_completed/);
  assert.match(tasks, /previouslyLoaded/);
  assert.match(tasks, /task_completed/);
  for (const id of [
    "search_started",
    "search_completed",
    "analysis_started",
    "task_completed",
    "image_started",
  ]) {
    assert.ok(NOTIFICATION_IDS.includes(id));
    assert.ok(notificationDefinition(id));
  }
});
