import assert from "node:assert/strict";
import test from "node:test";
import { isClearSidebarSwipe } from "../../src/lib/sidebar-swipe.mjs";

test("right-to-left opens a collapsed mobile drawer", () => {
  assert.equal(isClearSidebarSwipe({ open: false, dx: -110, dy: 10, elapsedMs: 280 }), true);
  assert.equal(isClearSidebarSwipe({ open: false, dx: 110, dy: 10, elapsedMs: 280 }), false);
});
test("left-to-right closes an expanded mobile drawer", () => {
  assert.equal(isClearSidebarSwipe({ open: true, dx: 110, dy: 10, elapsedMs: 280 }), true);
  assert.equal(isClearSidebarSwipe({ open: true, dx: -110, dy: 10, elapsedMs: 280 }), false);
});
test("vertical, incomplete and stale gestures are ignored", () => {
  for (const args of [
    { open: false, dx: -40, dy: 4, elapsedMs: 200 },
    { open: false, dx: -120, dy: 90, elapsedMs: 200 },
    { open: false, dx: -120, dy: 2, elapsedMs: 900 },
    { open: true, dx: 95, dy: 60, elapsedMs: 200 },
    { open: true, dx: Number.NaN, dy: 0, elapsedMs: 200 },
  ])
    assert.equal(isClearSidebarSwipe(args), false);
});
