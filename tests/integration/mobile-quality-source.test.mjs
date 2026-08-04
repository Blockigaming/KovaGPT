import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const styles = await readFile("src/styles.css", "utf8");
const topbar = await readFile("src/components/MobileTopBar.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const sheet = await readFile("src/components/MobileBottomSheet.tsx", "utf8");
const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");

test("phone chrome uses safe areas, practical touch targets, and a dedicated close action", () => {
  assert.match(topbar, /kova-topbar-inner/);
  assert.match(styles, /padding-right: max\(0\.35rem, var\(--safe-right\)\)/);
  assert.match(sidebar, /aria-label="Close navigation"/);
  assert.match(styles, /\.kova-message-actions button[\s\S]*min-width: 44px/);
});

test("rich mobile responses contain overflow and iOS form controls do not zoom", () => {
  assert.match(styles, /overscroll-behavior-inline: contain/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /textarea,[\s\S]*font-size: 16px/);
  assert.match(styles, /max-width: calc\(100vw - 1\.25rem\)/);
});

test("mobile settings and bottom sheets have bounded, safe-area-aware behavior", () => {
  assert.match(settings, /kova-settings-dialog/);
  assert.match(styles, /\.kova-settings-dialog[\s\S]*height: 100dvh/);
  assert.match(sheet, /max-h-\[min\(88dvh,44rem\)\]/);
  assert.doesNotMatch(sheet, /navigator\.vibrate/);
});
