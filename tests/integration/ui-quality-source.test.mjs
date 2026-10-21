import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("src/styles.css", "utf8");
const finalParityStyles = await readFile("src/styles/chatgpt-final-parity.css", "utf8");
const composerStyles = await readFile("src/styles/spec400-chat.css", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");
const root = await readFile("src/routes/__root.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const composer = await readFile("src/components/ChatInput.tsx", "utf8");
const starters = await readFile("src/components/HomeChatStarters.tsx", "utf8");
const modelSelector = await readFile("src/components/ResponsiveModelSelector.tsx", "utf8");
const pricing = await readFile("src/routes/pricing.tsx", "utf8");
const publicShell = await readFile("src/components/public/PublicShell.tsx", "utf8");
const publicFooter = await readFile("src/components/PublicFooter.tsx", "utf8");
const publicSite = await readFile("src/components/public/PublicSite.tsx", "utf8");
const resetPassword = await readFile("src/routes/reset-password.tsx", "utf8");
const seoLanding = await readFile("src/components/SeoLanding.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const states = await readFile("src/components/states.tsx", "utf8");
const logo = await readFile("src/components/NovaLogo.tsx", "utf8");
const logoAsset = await readFile("public/kova-logo.png");
const runtime = await readFile("src/components/PlatformRuntime.tsx", "utf8");
const uiQuality = await readFile("tests/e2e/ui-quality.spec.ts", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

test("shared interaction styles cover composer, menus, motion, and narrow phones", () => {
  assert.match(styles, /\.kova-composer:focus-within/);
  assert.match(styles, /\[role="menuitem"\]:focus-visible/);
  assert.match(styles, /@media \(max-width: 359px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    styles,
    /\.kova-empty-chat:has\(\.kova-composer-menu\) \.kova-starter-grid\s*\{[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kova-sidebar-scrim\s*\{[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(home, /const greeting = "What are you working on\?"/);
  assert.match(home, /<h1\s+id="chat-greeting"[^>]*>\s*\{greeting\}\s*<\/h1>/);
  assert.match(composer, /COMPOSER_TOOLS/);
  assert.match(composer, /renderComposerActions\(false\)/);
  assert.match(starters, /EMPTY_STATE_STARTERS\.map/);

  // A blocked attachment may explain the blocker, but it must not submit the message.
  assert.match(composer, /const blockedAttachmentMessage = blockedAttachment/);
  assert.match(
    composer,
    /const canSubmit =\s*!pasteOffer &&\s*!disabled &&\s*online &&\s*Boolean\(value\.trim\(\) \|\| validAttachmentInstruction\) &&\s*!blockedAttachmentMessage;/,
  );
  assert.match(
    composer,
    /disabled=\{!canSubmit\}\s*onClick=\{triggerSubmit\}[\s\S]*?aria-label="Send message"/,
  );
  const submit = composer.slice(
    composer.indexOf("const triggerSubmit ="),
    composer.indexOf("const nextSubmittingRef ="),
  );
  assert.match(submit, /if \(blockedAttachmentMessage\) \{[\s\S]*?return;\s*\}/);
  assert.ok(submit.indexOf("if (blockedAttachmentMessage)") < submit.indexOf("onSubmit("));
  assert.match(composer, /blockedAttachmentMessage \?\? \(!online \? "Reconnect to send"/);
  assert.match(
    composer,
    /\{blockedAttachmentMessage && \(\s*<p className="spec400-composer-hint" role="status">\s*\{blockedAttachmentMessage\}/,
  );
});

test("core chat surfaces use shared workspace primitives", () => {
  for (const className of ["kova-message", "kova-user-message", "kova-assistant-message"]) {
    assert.match(message, new RegExp(className));
  }
  for (const className of ["spec400-composer", "spec400-toolbar-button", "spec400-send-button"]) {
    assert.match(composer, new RegExp(className));
  }
  assert.match(sidebar, /kova-sidebar/);
  assert.match(sidebar, /kova-chat-row/);
  assert.match(sidebar, /kova-new-chat/);
  assert.match(styles, /overflow-anchor: auto/);
  assert.match(logo, /kova-logo-mark/);
  assert.match(logo, /<img\s+src="\/kova-logo\.png"/);
  assert.equal(logoAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(logo, /decorative = false/);
  assert.match(logo, /alt = "KovaGPT"/);
  assert.match(logo, /aria-hidden=\{decorative \|\| undefined\}/);
  assert.match(logo, /aria-label=\{decorative \? undefined : alt\}/);
  assert.match(logo, /alt=\{decorative \? "" : alt\}/);
  assert.match(logo, /data-logo-variant=\{mark \? "mark" : "standard"\}/);
  assert.doesNotMatch(logo, /<svg|onError=/);
  assert.doesNotMatch(styles, /\.kova-logo-mark\s*\{[\s\S]*?mask: url/);
  assert.match(
    sidebar,
    /<span className="kova-sidebar-brand[^"]*">\s*<NovaLogo decorative className="h-7 w-7" \/>\s*KovaGPT\s*<\/span>/,
  );
  assert.doesNotMatch(home, /<NovaLogo|kova-greeting-mark/);
  assert.match(publicSite, /<PublicShell>/);
  assert.doesNotMatch(publicSite, /<NovaLogo/);
  assert.match(publicShell, /<NovaLogo decorative className="h-7 w-7" \/>/);
  assert.match(publicFooter, /<NovaLogo decorative mark className="h-6 w-6" \/>/);
  assert.match(seoLanding, /<PublicShell>/);
  assert.doesNotMatch(seoLanding, /<NovaLogo/);
  assert.match(pricing, /<PublicShell>/);
  assert.doesNotMatch(pricing, /<NovaLogo/);
  assert.match(resetPassword, /<NovaLogo decorative className="w-4 h-4" \/>/);
  assert.match(
    uiQuality,
    /page\.route\("\*\*\/kova-logo\.png\*"[\s\S]*?rasterLogoRequests \+= 1;[\s\S]*?route\.continue\(\)/,
  );
  assert.match(uiQuality, /expect\(rasterLogoRequests\)\.toBeGreaterThanOrEqual\(1\)/);
  assert.match(uiQuality, /image\.complete && image\.naturalWidth > 0 && image\.naturalHeight > 0/);
  assert.match(uiQuality, /expect\(rasterLogoResponses\.every\(Boolean\)\)\.toBe\(true\)/);
});

test("the core workspace layer owns shell and composer visual contracts", () => {
  const coreStart = styles.indexOf("/* Core workspace overhaul:");
  const coreEnd = styles.indexOf("/* End core workspace overhaul.");
  const interactionStart = styles.indexOf("/* Interaction-quality layer.");
  const legacyEnd = styles.indexOf("/* Secondary workspace primitives:");
  const coreStyles = styles.slice(coreStart, coreEnd);
  const interactionStyles = styles.slice(interactionStart, legacyEnd);

  assert.match(styles, /@import "\.\/styles\/chatgpt-parity\.css";/);
  assert.match(styles, /@import "\.\/styles\/chatgpt-final-parity\.css";/);
  assert.doesNotMatch(styles, /@import "\.\/styles\/core-workspace\.css";/);
  assert.ok(coreStart > legacyEnd, "core rules must follow every legacy workspace block");
  assert.ok(coreEnd > coreStart, "the final core section must have a closing marker");
  // Later checkpoint repairs are deliberately limited to dialog fields,
  // backdrop corners and pointer row selection. They must not reopen shell or
  // composer geometry through another unbounded override layer.
  const trailingStyles = styles
    .slice(styles.indexOf("*/", coreEnd) + 2)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const trailingRules = [...trailingStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.equal(trailingStyles.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim(), "");
  assert.deepEqual(
    trailingRules.map(([, selector]) => selector.replace(/\s+/g, "")),
    [
      '[role="dialog"]forminput.border-input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"])',
      '[role="dialog"]form:is(label,div:has(>label)):has(+:is(input.border-input,textarea.border-input))',
      '[role="dialog"]formlabel>:is(input.border-input,textarea.border-input)',
      ":is(.kova-assistant,.kova-app-shell)button.kova-sidebar-scrim",
      'html[data-kova-input-modality="pointer"].kova-chat-row:has(.kova-chat-row-main:is(:focus,:active))',
      'html[data-kova-input-modality="pointer"].kova-chat-row>.kova-chat-row-main:is(:focus,:active,:hover)',
    ],
    "only the reviewed, scoped checkpoint repairs may follow the core section",
  );
  assert.doesNotMatch(runtime, /chatgpt-final-parity\.css/);
  assert.equal(
    (styles.match(/\/\* Core workspace overhaul:/g) ?? []).length,
    1,
    "one authoritative core workspace layer should remain",
  );
  assert.doesNotMatch(
    styles,
    /DAY10 composer focus contract|FINAL composer keyboard focus contract/,
  );
  assert.match(coreStyles, /\.kova-composer\s*\{/);
  assert.match(coreStyles, /\.kova-composer:focus-within/);
  assert.match(coreStyles, /outline: 2px solid var\(--kova-blue\) !important/);
  assert.match(coreStyles, /box-shadow: var\(--shadow-composer\) !important/);
  assert.match(
    coreStyles,
    /@media \(pointer: coarse\), \(max-width: 1023px\)[\s\S]*?\.kova-message-actions button\s*\{[\s\S]*?width: auto !important;[\s\S]*?height: auto !important;[\s\S]*?min-width: var\(--kova-touch\) !important;[\s\S]*?min-height: var\(--kova-touch\) !important;[\s\S]*?flex: 0 0 auto !important;[\s\S]*?white-space: nowrap;/,
  );
  for (const block of interactionStyles.matchAll(/\.kova-composer(?![-\w])[^,{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(
      block[1],
      /(?:background|border(?:-color|-radius)?|box-shadow|outline(?:-offset)?):[^;]*!important/,
      "legacy layered important declarations must not outrank the canonical composer surface",
    );
  }
  for (const selector of [".kova-topbar", ".kova-sidebar", ".kova-empty-chat"]) {
    assert.ok(
      styles.lastIndexOf(selector) >= coreStart,
      `${selector} must resolve from the final core section`,
    );
  }
  assert.match(finalParityStyles, /\.kova-composer:focus-within/);
  assert.match(finalParityStyles, /grid-template-columns: 44px minmax\(0, 1fr\) auto !important/);
  assert.ok(
    styles.indexOf('@import "./styles/spec400-chat.css";') >
      styles.indexOf('@import "./styles/chatgpt-final-parity.css";'),
    "the current composer stylesheet follows the inherited parity imports",
  );
  assert.match(composerStyles, /\.spec400-composer\s*\{[\s\S]*?min-height: 128px;/);
  assert.match(
    composerStyles,
    /\.spec400-composer\[data-focus-origin="keyboard"\]:focus-within\s*\{\s*outline: 2px solid var\(--ring\);\s*outline-offset: 2px;/,
  );
  assert.match(
    composerStyles,
    /\.spec400-send-button\s*\{\s*min-width: 44px;\s*width: 44px;\s*height: 44px;/,
  );
});

test("composer focus, menu placement, and truthful guest controls cannot regress", async () => {
  assert.doesNotMatch(composer, /outlineWidth:\s*"2px"/);
  assert.doesNotMatch(composer, /outlineColor:\s*"currentColor"/);
  assert.match(composer, /surface\?: "empty" \| "conversation"/);
  for (const className of ["kova-composer-menu spec400-attach-menu", "spec400-options-panel"]) {
    const popover = [...composer.matchAll(/<PopoverContent([\s\S]*?)>/g)].find(([, props]) =>
      props.includes(`className="${className}"`),
    )?.[1];
    assert.ok(popover, `${className} retains its positioned popover`);
    assert.match(popover, /side="top"/);
    assert.match(popover, /sideOffset=\{8\}/);
    assert.match(popover, /collisionPadding=\{12\}/);
  }
  assert.match(composer, /\{showAddMenu && isMobileLayout && \(\s*<MobileBottomSheet/);
  assert.match(composer, /ariaLabel="Attach files and tools"/);
  assert.match(composer, /restoreFocus=\{!contextOpen && !libraryOpen && !signInRequest\}/);
  assert.match(composerStyles, /\.spec400-toolbar-button,[\s\S]*?min-height: 44px;/);
  assert.match(composer, /\["ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(event\.key\)/);
  assert.match(composer, /button:not\(:disabled\),a\[href\]/);
  assert.match(composer, /controls\[next\]\?\.focus\(\)/);
  assert.match(composer, /onKeyDown=\{handleMenuKeyDown\}/);
  assert.match(composer, /isComposing: Boolean\(native\.isComposing \|\| composingRef\.current\)/);
  const stopButton = composer.match(
    /<button\s+type="button"\s+onClick=\{onStop\}[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(stopButton, "streaming always exposes the real cancellation handler");
  assert.match(stopButton, /aria-label="Stop generating"/);
  assert.doesNotMatch(stopButton, /disabled=|aria-disabled=/);
  assert.match(home, /surface="empty"/);
  assert.match(home, /<HomeChatStarters setInput=\{setInput\}/);
  assert.match(starters, /EMPTY_STATE_STARTERS/);
  assert.match(starters, /setInput\(\(current\) => \(current\.trim\(\) \? current : prompt\)\)/);
  assert.doesNotMatch(starters, /onSubmit|triggerSubmit|fetch\(/);
  assert.match(modelSelector, /kova-model-static/);

  const lockedBranch = modelSelector.match(/if \(locked\)[\s\S]*?<\/span>\s*\);/)?.[0] ?? "";
  assert.ok(lockedBranch, "locked model branch should remain explicit");
  assert.doesNotMatch(lockedBranch, /ChevronDown|pointer-events-none|aria-hidden/);
  assert.match(sidebar, /navLink\("\/discovery", "Discover", Compass\)/);
  assert.doesNotMatch(sidebar, /"Maps", Map, isOn\("\/maps"\), "New"/);
});

test("shell error and not-found states use safe copy, landmarks, and real recovery", () => {
  assert.match(home, /<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  assert.match(states, /id="main-content"\s+tabIndex=\{-1\}\s+className="kova-state-screen"/);
  assert.match(states, /data-app-error-boundary/);
  assert.match(states, /window\.location\.reload\(\)/);
  assert.match(states, /href="\/"/);
  assert.doesNotMatch(states, /incidentId|createIncidentId|app-error-reference/);
  assert.doesNotMatch(states, /description=\{this\.state\.error\.message\}/);
  assert.match(
    root,
    /function NotFoundComponent\(\)[\s\S]*?<main id="main-content" tabIndex=\{-1\}/,
  );
  assert.match(root, /This page isn’t available/);
  assert.match(
    root,
    /function ErrorComponent[\s\S]*?<main id="main-content" tabIndex=\{-1\} className="kova-state-screen"/,
  );
});

test("streaming status reports only real activity instead of invented progression", () => {
  assert.match(message, /CONTINUED_WAIT_MS = 8_000/);
  assert.match(message, /EXTENDED_WAIT_MS = 30_000/);
  assert.match(message, /Date\.now\(\) - startedAt/);
  assert.match(message, /activity\.status === "running"/);
  assert.match(message, /localStreamingStartedAtRef = useRef<number \| null>\(null\)/);
  assert.match(message, /if \(!streaming\) localStreamingStartedAtRef\.current = null/);
  assert.match(message, /streamingStartedAt \?\? localStreamingStartedAtRef\.current/);
  assert.match(home, /startedAt: Date\.now\(\)/);
  assert.match(home, /inFlightTargetRef\.current\?\.conversationId === active\.id/);
  assert.match(home, /inFlightTargetRef\.current\.assistantMessageId === m\.id/);
  assert.match(message, /"Still waiting for the response"/);
  assert.match(message, /"Taking a little longer"/);
  assert.match(message, /Math\.max\(0, Math\.floor\(\(Date\.now\(\) - startedAt\) \/ 1000\)\)/);
  assert.match(message, /return \(\) => window\.clearInterval\(timer\)/);
  assert.match(
    message,
    /<li aria-current="step">\{active \? "Tool in progress" : "Waiting for reply"\}/,
  );
  assert.match(message, /elapsedSeconds >= 8 && \(\s*<span role="timer" aria-live="off"/);
  assert.doesNotMatch(message, /IDLE_STATUSES|Planning response|Finishing response/);
  assert.match(message, /kova-thinking-indicator/);
  assert.match(message, /role="status"/);
  assert.match(message, /aria-atomic="true"/);
  assert.match(message, /activity\.status !== "running"/);
});

test("the public visual gate executes the focused Chromium interactions and screenshots", () => {
  const command = packageJson.scripts["test:visual"];
  assert.match(command, /node --test tests\/visual\/\*\.test\.mjs/);
  assert.match(
    command,
    /KOVA_BROWSER_PREVIEW=node playwright test tests\/e2e\/ui-quality\.spec\.ts/,
  );
  assert.match(command, /--project=phone-390x844/);
  assert.match(command, /--project=tablet-1024x768/);
  assert.match(command, /--project=desktop-1440x900/);
  assert.doesNotMatch(command, /--grep/);
});
