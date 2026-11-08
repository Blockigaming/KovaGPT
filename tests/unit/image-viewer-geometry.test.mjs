import assert from "node:assert/strict";
import test from "node:test";
import { clampImageView } from "../../src/lib/image-viewer-geometry.ts";

test("a small image cannot be dragged off screen when it still fits", () => {
  assert.deepEqual(
    clampImageView(
      { scale: 2, x: 900, y: -900 },
      { width: 120, height: 80 },
      { width: 320, height: 600 },
    ),
    { scale: 2, x: 0, y: 0 },
  );
});
test("panning stops at the actual scaled image edges", () => {
  assert.deepEqual(
    clampImageView(
      { scale: 5, x: 900, y: -900 },
      { width: 120, height: 80 },
      { width: 320, height: 600 },
    ),
    { scale: 5, x: 140, y: 0 },
  );
});
test("zooming back to fit recenters a previously panned image", () => {
  assert.deepEqual(
    clampImageView(
      { scale: 1, x: 140, y: 150 },
      { width: 320, height: 200 },
      { width: 320, height: 600 },
    ),
    { scale: 1, x: 0, y: 0 },
  );
});
