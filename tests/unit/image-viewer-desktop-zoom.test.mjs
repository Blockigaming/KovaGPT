import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewer = readFileSync("src/components/ChatImageViewer.tsx", "utf8");

test("image viewer offers desktop double-click zoom and reset", () => {
  assert.match(viewer, /onDoubleClick=\{\(\) => \{/);
  assert.match(viewer, /current\.scale > 1/);
  assert.match(viewer, /bounded\(\{ \.\.\.current, scale: 2 \}\)/);
});

test("trackpad pinch uses non-passive listener and does not intercept ordinary scroll", () => {
  assert.match(viewer, /addEventListener\("wheel", onPinchWheel, \{ passive: false \}\)/);
  assert.match(viewer, /if \(!event\.ctrlKey && !event\.metaKey\) return/);
  assert.match(viewer, /canvas\.removeEventListener\("wheel", onPinchWheel\)/);
  assert.match(viewer, /clampImageView\(/);
});
