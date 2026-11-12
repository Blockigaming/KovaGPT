import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationDefinition } from "../../src/lib/notification-catalog.mjs";

test("contextual tips never become full blocking dialogs by default", () => {
  for (const id of ["try_feature", "check_this_out", "quick_tip", "did_you_know"])
    assert.equal(notificationDefinition(id)?.surface, "popover");
  for (const id of ["app_update", "feature_changing", "feature_retired"])
    assert.equal(notificationDefinition(id)?.surface, "banner");
  assert.equal(notificationDefinition("confirm_account_delete")?.surface, "modal");
});

test("nonblocking notices do not claim aria-modal and respect current dialogs", () => {
  const controller = readFileSync("src/components/KovaNotificationController.tsx", "utf8");
  const panel = readFileSync("src/components/KovaNotificationPanel.tsx", "utf8");
  assert.match(controller, /externalDialogOpen/);
  assert.match(controller, /externalDialogOpen && \(definition\.exclusive \|\| lowPriority\)/);
  assert.match(controller, /MutationObserver/);
  assert.match(panel, /aria-modal=\{nonBlocking \? undefined : true\}/);
  assert.match(panel, /event\.key !== "Tab" \|\| !panelRef\.current \|\| nonBlocking/);
  assert.match(panel, /anchorSelector/);
  assert.match(panel, /setAnchorPosition/);
});

test("desktop contextual UI and mobile release banners are independent of blocking sheets", () => {
  const css = readFileSync("src/components/kova-notification-surface.css", "utf8");
  assert.match(css, /data-surface="popover"/);
  assert.match(css, /data-surface="banner"/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /--kova-notice-popover-left/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("streaming changes do not repeatedly scan hidden or offscreen dialogs", () => {
  const host = readFileSync("src/components/KovaNotificationController.tsx", "utf8");
  assert.match(host, /new MutationObserver/);
  assert.match(host, /requestAnimationFrame/);
  assert.match(host, /cancelAnimationFrame/);
  assert.match(host, /getClientRects\(\)\.length > 0/);
  assert.match(host, /getComputedStyle\(element\)\.visibility !== "hidden"/);
});
