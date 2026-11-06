import assert from "node:assert/strict";
import test from "node:test";
import { composerKeyboardInset } from "../../src/lib/composer-keyboard-inset.mjs";

const viewport = {
  layoutHeight: 844,
  viewportHeight: 510,
  viewportTop: 24,
  scale: 1,
  focused: true,
};

test("keyboard compensation accounts for viewport panning and closes with the keyboard", () => {
  assert.equal(composerKeyboardInset(viewport), 310);
  assert.equal(composerKeyboardInset({ ...viewport, viewportHeight: 844, viewportTop: 0 }), 0);
  assert.equal(composerKeyboardInset({ ...viewport, viewportHeight: 830, viewportTop: 0 }), 0);
});

test("pinch zoom and focus in another control never leave a large composer gap", () => {
  assert.equal(composerKeyboardInset({ ...viewport, scale: 2 }), 0);
  assert.equal(composerKeyboardInset({ ...viewport, focused: false }), 0);
  assert.equal(composerKeyboardInset({ ...viewport, viewportHeight: NaN }), 0);
});
