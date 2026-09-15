import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/components/MobileBottomSheet.tsx", import.meta.url),
  "utf8",
);

test("mobile sheets delegate isolation and nested layer handling to the existing dialog primitive", () => {
  assert.match(source, /@radix-ui\/react-dialog/);
  for (const part of ["Root", "Portal", "Overlay", "Content", "Title", "Close"]) {
    assert.ok(source.includes(`<DialogPrimitive.${part}`));
  }
  assert.doesNotMatch(source, /addEventListener\("keydown"|document\.body\.style\.overflow\s*=/);
  assert.match(source, /onCloseAutoFocus/);
  assert.match(source, /previouslyFocused\.current\?\.isConnected/);
  assert.match(source, /aria-describedby=\{undefined\}/);
  assert.match(source, /title \|\| ariaLabel \|\| "Options"/);
});

test("interrupted and multi-touch sheet gestures reset without relying on a stale render", () => {
  assert.match(source, /onTouchCancel=\{resetDrag\}/);
  assert.match(source, /event\.touches\.length !== 1/);
  assert.match(source, /const dismiss = dragDistance\.current > 90/);
  assert.match(source, /if \(!open\) resetDrag\(\)/);
  assert.match(source, /motion-reduce:animate-none/);
  assert.match(source, /max-h-\[min\(88dvh,44rem\)\]/);
});
