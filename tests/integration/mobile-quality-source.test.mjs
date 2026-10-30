import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const styles = await readFile("src/styles.css", "utf8");
const topbar = await readFile("src/components/MobileTopBar.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const sheet = await readFile("src/components/MobileBottomSheet.tsx", "utf8");
const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
const chatStyles = await readFile("src/styles/spec400-chat.css", "utf8");
const responseStyles = await readFile("src/components/response-action-refinement.css", "utf8");
const settingsStyles = await readFile("src/styles/settings-reference.css", "utf8");

test("phone chrome uses safe areas, practical touch targets, and a dedicated close action", () => {
  assert.match(topbar, /kova-topbar-inner/);
  assert.match(topbar, /data-ui-reference="chatgpt-mobile-topbar"/);
  assert.match(
    sidebarStyles,
    /\.kova-topbar:not\(\.kova-desktop-topbar\)\s*\{[^}]*padding-top: env\(safe-area-inset-top, 0px\)/,
  );
  assert.match(
    sidebarStyles,
    /\.kova-topbar:not\(\.kova-desktop-topbar\) \.kova-topbar-inner\s*\{[^}]*padding-left: max\(0\.5rem, var\(--safe-left, 0px\)\);[^}]*padding-right: max\(0\.5rem, var\(--safe-right, 0px\)\)/,
  );
  assert.match(
    chatStyles,
    /\.spec400-composer-dock\s*\{[^}]*padding-inline: calc\(max\(var\(--chat-gutter\), var\(--safe-left\)\) - 4px\)\s*calc\(max\(var\(--chat-gutter\), var\(--safe-right\)\) - 4px\)/,
  );
  assert.match(sidebar, /aria-label="Close sidebar"/);
  assert.match(
    responseStyles,
    /@media \(any-pointer: coarse\), \(max-width: 1023px\)\s*\{\s*:is\(\.kova-assistant, \.kova-project-chat\)\s*\.kova-message-actions\.kova-response-action-bar\s*button\.kova-message-icon-action\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px/,
  );
});

test("rich mobile responses contain overflow and iOS form controls do not zoom", () => {
  assert.match(styles, /overscroll-behavior-inline: contain/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /textarea,[\s\S]*font-size: 16px/);
  assert.match(styles, /max-width: calc\(100vw - 1\.25rem\)/);
});

test("mobile settings and bottom sheets have bounded, safe-area-aware behavior", () => {
  assert.match(settings, /kova-settings-dialog/);
  assert.match(
    settingsStyles,
    /@media \(max-width: 767px\)\s*\{\s*\[role="dialog"\]\.kova-settings-dialog,\s*\[role="dialog"\]\.kova-settings-dialog\.is-authenticated\s*\{[^}]*inset: 0;[^}]*width: 100vw;[^}]*height: 100dvh;[^}]*transform: none;[^}]*translate: none;[^}]*padding-top: var\(--safe-top\);[^}]*padding-bottom: var\(--safe-bottom\)/,
  );
  assert.match(sheet, /max-h-\[min\(88dvh,44rem\)\]/);
  assert.match(sheet, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  assert.match(sheet, /onTouchCancel=\{resetDrag\}/);
  assert.doesNotMatch(sheet, /navigator\.vibrate/);
});
