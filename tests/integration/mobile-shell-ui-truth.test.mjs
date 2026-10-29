import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

function roleDialogSizeRules(styles) {
  const matches = [];
  postcss.parse(styles).walkRules((rule) => {
    if (!rule.selector.includes('[role="dialog"]')) return;
    if (rule.nodes.some((node) => node.type === "decl" && /^max-(width|height)$/.test(node.prop)))
      matches.push(rule.selector);
  });
  return matches;
}

test("Temporary Chat is reachable and truthfully selected from the mobile top bar", async () => {
  const [topBar, route, temporaryControls] = await Promise.all([
    read("src/components/MobileTopBar.tsx"),
    read("src/routes/index.tsx"),
    read("src/components/TemporaryChatStartDialog.tsx"),
  ]);

  assert.match(topBar, /MessageCircleOff/);
  assert.match(topBar, /isSignedIn && !chatStarted && onTemporaryChatChange/);
  assert.match(topBar, /onTemporaryChatChange\(!temporaryChat, event.currentTarget\)/);
  assert.match(topBar, /aria-pressed=\{temporaryChat\}/);
  assert.match(topBar, /data-state=\{temporaryChat \? "on" : "off"\}/);
  assert.match(topBar, /h-11 w-11/);
  assert.match(route, /temporaryChat=\{tempChat\}/);
  assert.match(route, /chatStarted=\{chatStarted\}/);
  assert.match(
    route,
    /onTemporaryChatChange=\{\(enabled, trigger\) => \{\s+temporaryTriggerRef.current = trigger;\s+temporaryReturnUrlRef.current = window.location.href;\s+setTemporaryChatEnabled\(enabled\);/,
  );
  assert.match(route, /isLoaded && isSignedIn && !chatStarted/);
  assert.match(
    route,
    /onToggle=\{\(trigger\) => \{\s+temporaryTriggerRef.current = trigger;\s+temporaryReturnUrlRef.current = window.location.href;\s+setTemporaryChatEnabled\(!tempChat\);/,
  );
  assert.match(route, /if \(chatStarted \|\| enabled === tempChat\) return/);
  assert.match(temporaryControls, /onClick=\{\(event\) => onToggle\(event.currentTarget\)\}/);
  assert.match(temporaryControls, /aria-pressed=\{enabled\}/);
  assert.match(route, /onTurnOff=\{\(\) => setTemporaryChatEnabled\(false\)\}/);
  assert.match(temporaryControls, /onClick=\{onTurnOff\}/);
  assert.match(
    temporaryControls,
    /does not use or update saved memory, profile details, custom instructions, personality settings, or connected apps/,
  );
  assert.match(temporaryControls, /will not create new saved memories/);
  const startedBanner = route.match(
    /tempChat && chatStarted \? \(([\s\S]*?)\) : tempChat \? \(/,
  )?.[1];
  assert.ok(startedBanner, "Started temporary chats render the status-only branch");
  assert.match(startedBanner, /Start a new chat to change this setting/);
  assert.doesNotMatch(startedBanner, /TemporaryChatBanner|onSave|onTurnOff/);
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
  const parsedStyles = postcss.parse(styles);
  const narrowSurfaces = [];
  parsedStyles.walkRules("[data-kova-dialog-surface]", (rule) => {
    if (
      rule.parent.type === "atrule" &&
      rule.parent.name === "media" &&
      rule.parent.params === "(max-width: 767px)"
    )
      narrowSurfaces.push(rule);
  });
  assert.equal(narrowSurfaces.length, 0, "the global phone stylesheet must not resize every modal");
  for (const primitive of [dialog, alertDialog]) {
    assert.ok(primitive.includes("w-[calc(100%-2rem)]"));
    assert.ok(primitive.includes("max-w-[450px]"));
    assert.ok(primitive.includes("bg-popover p-5 text-popover-foreground"));
    assert.ok(primitive.includes("max-h-[calc(100vh-2rem)]"));
    assert.ok(
      primitive.includes("100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem"),
    );
    assert.ok(primitive.includes("overflow-y-auto overscroll-contain"));
  }
  assert.doesNotMatch(
    styles,
    /:where\(\[role="dialog"\]\):not\(\[data-side\]\):not\(\[data-image-lightbox\]\)/,
  );
  // Inspect declarations in the same CSS rule. A following media query is not
  // a size declaration on the preceding radius-only dialog selector.
  assert.deepEqual(roleDialogSizeRules(styles), []);
  const sidebarStyles = postcss.parse(await read("src/styles/sidebar-core.css"));
  const coarseOptions = [];
  sidebarStyles.walkRules(".kova-sidebar .kova-chat-options", (rule) => {
    if (
      rule.parent.type === "atrule" &&
      rule.parent.name === "media" &&
      rule.parent.params === "(pointer: coarse), (max-width: 1023px)"
    )
      coarseOptions.push(
        Object.fromEntries(
          rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
        ),
      );
  });
  assert.equal(coarseOptions.length, 1);
  for (const dimension of ["width", "min-width", "height", "min-height"])
    assert.equal(coarseOptions[0][dimension], "44px");
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
  assert.match(palette, /<Button[\s\S]*?size="icon"/);
  const button = await read("src/components/ui/button.tsx");
  assert.match(button, /icon: "h-9 w-9/);
  assert.match(button, /pointer:coarse/);
  assert.match(button, /min-h-11/);
  assert.match(button, /min-w-11/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("modal size guard rejects role-wide sizing without matching neighboring media queries", () => {
  assert.deepEqual(
    roleDialogSizeRules(
      '[role="dialog"].named-dialog { border-radius: 28px; } @media (max-width: 767px) { .named-dialog { border-radius: 20px; } }',
    ),
    [],
  );
  assert.deepEqual(roleDialogSizeRules('[role="dialog"] { max-width: 90vw; max-height: 90vh; }'), [
    '[role="dialog"]',
  ]);
  assert.deepEqual(roleDialogSizeRules("[data-kova-dialog-surface] { max-width: 90vw; }"), []);
});
