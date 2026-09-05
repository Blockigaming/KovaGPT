import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("src/styles.css", "utf8");
const finalParityStyles = await readFile("src/styles/chatgpt-final-parity.css", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");
const root = await readFile("src/routes/__root.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const composer = await readFile("src/components/ChatInput.tsx", "utf8");
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
  assert.match(home, /What can I help with\?/);
  assert.match(home, /placement="topbar"/);
  assert.match(composer, /COMPOSER_TOOLS/);
  assert.match(composer, /PROMPT_SHORTCUTS/);

  // A blocked attachment may explain the blocker, but it must not submit the message.
  assert.match(composer, /const blockedAttachmentMessage = blockedAttachment/);
  assert.match(composer, /onClick=\{blockedAttachmentMessage \? triggerSubmit : undefined\}/);
  assert.match(composer, /aria-disabled=\{blockedAttachmentMessage \? true : undefined\}/);
  assert.match(composer, /blockedAttachmentMessage \?\? "Type a message to send"/);
});

test("core chat surfaces use shared workspace primitives", () => {
  for (const className of ["kova-message", "kova-user-message", "kova-assistant-message"]) {
    assert.match(message, new RegExp(className));
  }
  for (const className of ["kova-attach-button", "kova-tool-button", "kova-send-button"]) {
    assert.match(composer, new RegExp(className));
  }
  assert.match(sidebar, /kova-sidebar/);
  assert.match(sidebar, /kova-chat-row/);
  assert.match(sidebar, /kova-new-chat/);
  assert.match(styles, /overflow-anchor: auto/);
  assert.match(logo, /kova-logo-mark/);
  assert.match(logo, /<svg[\s\S]*?viewBox="0 0 24 24"[\s\S]*?<circle[\s\S]*?<path/);
  assert.match(logo, /decorative = false/);
  assert.match(logo, /alt = "KovaGPT"/);
  assert.match(logo, /aria-hidden=\{decorative \|\| undefined\}/);
  assert.match(logo, /aria-label=\{decorative \? undefined : alt\}/);
  assert.match(logo, /role=\{decorative \? undefined : "img"\}/);
  assert.match(logo, /data-logo-variant=\{mark \? "mark" : "standard"\}/);
  assert.doesNotMatch(logo, /<img|kova-logo\.png/);
  assert.doesNotMatch(styles, /\.kova-logo-mark\s*\{[\s\S]*?mask: url/);
  assert.match(sidebar, /<NovaLogo decorative mark className="h-6 w-6 text-foreground" \/>/);
  assert.match(home, /<NovaLogo decorative mark className="h-5 w-5" \/>/);
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
    /page\.route\("\*\*\/kova-logo\.png\*"[\s\S]*?rasterLogoRequests \+= 1;[\s\S]*?route\.abort\(\)/,
  );
  assert.match(uiQuality, /expect\(rasterLogoRequests\)\.toBe\(0\)/);
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
  assert.equal(
    styles.slice(coreEnd).trim(),
    "/* End core workspace overhaul. Keep this section last in the stylesheet. */",
    "no later source rule may override the authoritative core section",
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
});

test("composer focus, menu placement, and truthful guest controls cannot regress", async () => {
  assert.doesNotMatch(composer, /outlineWidth:\s*"2px"/);
  assert.doesNotMatch(composer, /outlineColor:\s*"currentColor"/);
  assert.match(composer, /surface\?: "empty" \| "conversation"/);
  assert.match(composer, /top-\[calc\(100%\+1\.25rem\)\]/);
  assert.match(composer, /bottom-\[calc\(100%\+1\.25rem\)\]/);
  assert.match(composer, /mobile \? "min-h-14[^"\n]+" : "min-h-11/);
  assert.match(home, /surface="empty"/);
  assert.match(home, /<HomeChatStarters setInput=\{setInput\}/);
  assert.match(
    await readFile("src/components/HomeChatStarters.tsx", "utf8"),
    /EMPTY_STATE_STARTERS/,
  );
  assert.match(
    await readFile("src/components/HomeChatStarters.tsx", "utf8"),
    /setInput\(\(current\)/,
  );
  assert.match(modelSelector, /kova-model-static/);

  const lockedBranch = modelSelector.match(/if \(locked\)[\s\S]*?<\/span>\s*\);/)?.[0] ?? "";
  assert.ok(lockedBranch, "locked model branch should remain explicit");
  assert.doesNotMatch(lockedBranch, /ChevronDown|pointer-events-none|aria-hidden/);
  assert.match(sidebar, /"Discover", Globe, isOn\("\/discovery"\)/);
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
  assert.match(root, /We couldn't find that page/);
  assert.match(
    root,
    /function ErrorComponent[\s\S]*?<main id="main-content" tabIndex=\{-1\} className="kova-state-screen"/,
  );
});

test("streaming status reports only real activity instead of invented progression", () => {
  assert.match(message, /let label = "Thinking"/);
  assert.doesNotMatch(message, /IDLE_STATUSES|Planning response|Finishing response/);
  assert.match(message, /kova-thinking-indicator/);
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
