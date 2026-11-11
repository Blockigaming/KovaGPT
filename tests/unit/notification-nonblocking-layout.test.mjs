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
  const src = readFileSync("src/components/KovaNotificationSurface.tsx", "utf8");
  assert.match(src, /externalDialogOpen/);
  assert.match(src, /MutationObserver/);
  assert.match(src, /aria-modal=\{nonBlocking \? undefined : true\}/);
  assert.match(src, /event\.key !== "Tab" \|\| !panelRef\.current \|\| nonBlocking/);
  assert.match(src, /anchorSelector/);
  assert.match(src, /setAnchorPosition/);
});

test("desktop contextual UI and mobile release banners are independent of blocking sheets", () => {
  const css = readFileSync("src/components/kova-notification-surface.css", "utf8");
  assert.match(css, /data-surface="popover"/);
  assert.match(css, /data-surface="banner"/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /--kova-notice-popover-left/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
