import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Temporary Chat is reachable and truthfully selected from the mobile top bar", async () => {
  const [topBar, route] = await Promise.all([
    read("src/components/MobileTopBar.tsx"),
    read("src/routes/index.tsx"),
  ]);

  assert.match(topBar, /MessageSquareDashed/);
  assert.match(topBar, /onTemporaryChatChange\(!temporaryChat\)/);
  assert.match(topBar, /aria-pressed=\{temporaryChat\}/);
  assert.match(topBar, /data-state=\{temporaryChat \? "on" : "off"\}/);
  assert.match(topBar, /h-11 w-11/);
  assert.match(route, /temporaryChat=\{tempChat\}/);
  assert.match(route, /onTemporaryChatChange=\{setTemporaryChatEnabled\}/);
  assert.match(route, /onClick=\{\(\) => setTemporaryChatEnabled\(!tempChat\)\}/);
  assert.match(route, /onClick=\{\(\) => setTemporaryChatEnabled\(false\)\}/);
  assert.match(route, /This chat won't appear in history or be used for cross-chat memory/);
  assert.doesNotMatch(route, /It's private/);
});

test("header progress never invents activity", async () => {
  const route = await read("src/routes/index.tsx");

  assert.doesNotMatch(route, /AIStatus/);
  await assert.rejects(read("src/components/AIStatus.tsx"), /ENOENT/);
});

test("narrow-phone constraints are scoped to real modal surfaces", async () => {
  const [styles, dialog, alertDialog, sheet, drawer] = await Promise.all([
    read("src/styles.css"),
    read("src/components/ui/dialog.tsx"),
    read("src/components/ui/alert-dialog.tsx"),
    read("src/components/ui/sheet.tsx"),
    read("src/components/ui/drawer.tsx"),
  ]);

  assert.match(dialog, /data-kova-dialog-surface=""/);
  assert.match(alertDialog, /data-kova-dialog-surface=""/);
  assert.doesNotMatch(sheet, /data-kova-dialog-surface/);
  assert.doesNotMatch(drawer, /data-kova-dialog-surface/);
  assert.match(styles, /\[data-kova-dialog-surface\]/);
  assert.doesNotMatch(
    styles,
    /:where\(\[role="dialog"\]\):not\(\[data-side\]\):not\(\[data-image-lightbox\]\)/,
  );
  assert.doesNotMatch(styles, /\[role="dialog"\][\s\S]{0,200}max-(?:width|height)/);
  assert.match(
    styles,
    /\.kova-sidebar \[aria-label="Chat options"\][\s\S]*min-width: var\(--kova-touch\)/,
  );
});

test("command palette traps and restores focus with safe-area and reduced-motion support", async () => {
  const [palette, styles] = await Promise.all([
    read("src/components/CommandPalette.tsx"),
    read("src/styles.css"),
  ]);

  assert.match(palette, /returnFocusRef/);
  assert.match(palette, /const returnTarget = returnFocusRef\.current/);
  assert.match(palette, /requestAnimationFrame\(\(\) => returnTarget\?\.focus\(\)\)/);
  assert.match(palette, /event\.key === "Tab"/);
  assert.match(
    palette,
    /onClick=\{\(\) => \{[\s\S]*suppressFocusRestore\(\);[\s\S]*onOpenSettings\(\)/,
  );
  assert.match(
    palette,
    /action\.action === "focus-input"[\s\S]*suppressFocusRestore\(\);[\s\S]*textarea/,
  );
  assert.match(palette, /data-kova-shell-overlay=""/);
  assert.match(palette, /var\(--safe-top\)/);
  assert.match(palette, /var\(--safe-bottom\)/);
  assert.match(palette, /h-11 w-11/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
