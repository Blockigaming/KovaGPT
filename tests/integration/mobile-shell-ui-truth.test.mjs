import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Temporary Chat is reachable and truthfully selected from the mobile top bar", async () => {
  const [topBar, route, temporaryControls] = await Promise.all([
    read("src/components/MobileTopBar.tsx"),
    read("src/routes/index.tsx"),
    read("src/components/TemporaryChatStartDialog.tsx"),
  ]);

  assert.match(topBar, /MessageSquareDashed/);
  assert.match(topBar, /onTemporaryChatChange\(!temporaryChat\)/);
  assert.match(topBar, /aria-pressed=\{temporaryChat\}/);
  assert.match(topBar, /data-state=\{temporaryChat \? "on" : "off"\}/);
  assert.match(topBar, /h-11 w-11/);
  assert.match(route, /temporaryChat=\{tempChat\}/);
  assert.match(route, /onTemporaryChatChange=\{setTemporaryChatEnabled\}/);
  assert.match(route, /onToggle=\{\(\) => setTemporaryChatEnabled\(!tempChat\)\}/);
  assert.match(temporaryControls, /onClick=\{onToggle\}/);
  assert.match(temporaryControls, /aria-pressed=\{enabled\}/);
  assert.match(route, /onTurnOff=\{\(\) => setTemporaryChatEnabled\(false\)\}/);
  assert.match(temporaryControls, /onClick=\{onTurnOff\}/);
  assert.match(
    temporaryControls,
    /does not use or update saved memory, profile details, custom instructions, personality settings, or connected apps/,
  );
  assert.match(temporaryControls, /will not create new saved memories/);
  assert.doesNotMatch(route, /It's private/);
});

test("header progress never invents activity", async () => {
  const route = await read("src/routes/index.tsx");

  assert.doesNotMatch(route, /AIStatus/);
  await assert.rejects(read("src/components/AIStatus.tsx"), /ENOENT/);
});

test("narrow-phone constraints are scoped to real modal surfaces", async () => {
  const [styles, dialog, alertDialog, sheet, drawer, images, shellOverlay] = await Promise.all([
    read("src/styles.css"),
    read("src/components/ui/dialog.tsx"),
    read("src/components/ui/alert-dialog.tsx"),
    read("src/components/ui/sheet.tsx"),
    read("src/components/ui/drawer.tsx"),
    read("src/routes/images.tsx"),
    read("src/components/CommandPalette.tsx"),
  ]);

  assert.match(dialog, /data-kova-dialog-surface=\{constrainToViewport \? "" : undefined\}/);
  assert.match(alertDialog, /data-kova-dialog-surface=""/);
  assert.doesNotMatch(sheet, /data-kova-dialog-surface/);
  assert.doesNotMatch(drawer, /data-kova-dialog-surface/);
  assert.match(images, /constrainToViewport=\{false\}/);
  assert.doesNotMatch(images, /data-kova-dialog-surface/);
  assert.doesNotMatch(shellOverlay, /data-kova-dialog-surface/);
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
  assert.match(palette, /function resolveReturnFocusTarget/);
  assert.match(palette, /target\?\.isConnected/);
  assert.match(palette, /data-testid="model-selector-trigger"/);
  assert.match(palette, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(palette, /requestAnimationFrame\(restoreFocus\)/);
  assert.match(palette, /const closePalette = \(\) =>/);
  assert.match(palette, /queueMicrotask\(restoreFocus\)/);
  assert.match(palette, /document\.activeElement !== target/);
  assert.match(palette, /searchInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(palette, /<input\s+autoFocus/);
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
  assert.match(palette, /h-11 w-11 shrink-0/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
