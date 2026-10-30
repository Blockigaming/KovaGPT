import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const styles = await readFile("src/styles.css", "utf8");
const coreStyles = await readFile("src/styles/core-system.css", "utf8");
const menuStyles = await readFile("src/styles/composer-core.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
const responseStyles = await readFile("src/components/response-action-refinement.css", "utf8");
const popover = await readFile("src/components/ui/popover.tsx", "utf8");
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

function openingTag(source, name, marker) {
  const matches = [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))]
    .map(([tag]) => tag)
    .filter((tag) => marker.test(tag));
  assert.equal(matches.length, 1, `one ${name} element must match ${marker}`);
  return matches[0];
}

function declarations(source, selector, media = null) {
  const matches = [];
  postcss.parse(source).walkRules((rule) => {
    if (!rule.selectors.some((value) => value.replace(/\s+/g, " ").trim() === selector)) return;
    const mediaParents = [];
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "media") mediaParents.unshift(parent.params);
    }
    if ((mediaParents.join(" / ") || null) === media) matches.push(rule);
  });
  assert.ok(matches.length > 0, `the canonical stylesheet must own ${selector} under ${media}`);
  return Object.assign(
    {},
    ...matches.map((rule) =>
      Object.fromEntries(
        rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
      ),
    ),
  );
}

test("shared interaction styles cover composer, menus, motion, and narrow phones", () => {
  const focus = declarations(
    composerStyles,
    '.spec400-composer[data-focus-origin="keyboard"]:focus-within',
  );
  assert.equal(focus.outline, "2px solid var(--ring)");
  assert.equal(focus["outline-offset"], "2px");
  assert.match(styles, /\[role="menuitem"\]:focus-visible/);
  assert.match(styles, /@media \(max-width: 359px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  // The current prompts are vertical rows. Portaled menus own a higher,
  // viewport-bounded layer instead of hiding an obsolete starter grid.
  assert.match(starters, /className="spec400-starter-actions"/);
  assert.doesNotMatch(starters, /kova-starter-grid/);
  assert.match(popover, /<PopoverPrimitive\.Portal>/);
  assert.match(popover, /z-50/);
  assert.match(popover, /var\(--radix-popover-content-available-height/);
  assert.match(popover, /overflow-y-auto overflow-x-hidden overscroll-contain/);
  const scrim = declarations(sidebarStyles, "button.kova-sidebar-scrim");
  assert.equal(scrim["border-radius"], "0");
  assert.equal(scrim.background, "#0008");
  assert.equal(scrim["backdrop-filter"], undefined);
  assert.match(
    coreStyles,
    /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kova-composer-menu\)[\s\S]*?background: var\(--background\) !important;/,
  );
  assert.match(home, /const greeting = "How can I help today\?"/);
  assert.match(openingTag(home, "h1", /id="chat-greeting"/), /id="chat-greeting"/);
  assert.match(home, /id="chat-greeting"[^>]*>\s*\{greeting\}\s*<\/h1>/);
  assert.match(composer, /COMPOSER_TOOLS/);
  assert.match(composer, /renderComposerActions\(false\)/);
  assert.match(starters, /EMPTY_STATE_STARTERS\.map/);

  // A blocked attachment may explain the blocker, but it must not submit the message.
  assert.match(composer, /const blockedAttachmentMessage = blockedAttachment/);
  assert.match(
    composer,
    /const canSubmit =\s*!pasteOffer &&\s*!disabled &&\s*!sendDisabled &&\s*online &&\s*Boolean\(value\.trim\(\) \|\| validAttachmentInstruction\) &&\s*!blockedAttachmentMessage;/,
  );
  const sendButton = openingTag(composer, "button", /aria-label="Send message"/);
  assert.match(sendButton, /disabled=\{!canSubmit\}/);
  assert.match(sendButton, /onClick=\{triggerSubmit\}/);
  assert.match(sendButton, /hidden=\{!hasDraft\}/);
  const submit = composer.slice(
    composer.indexOf("const triggerSubmit ="),
    composer.indexOf("const nextSubmittingRef ="),
  );
  assert.match(submit, /if \(blockedAttachmentMessage\) \{[\s\S]*?return;\s*\}/);
  assert.ok(submit.indexOf("if (blockedAttachmentMessage)") < submit.indexOf("onSubmit("));
  assert.match(composer, /blockedAttachmentMessage\s*\?\?\s*\(!online \? "Reconnect to send"/);
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
  const sidebarBrand = sidebar.match(
    /<span\b[^>]*className="kova-sidebar-brand[^"]*"[^>]*>([\s\S]*?)<\/span>/,
  )?.[1];
  assert.ok(sidebarBrand, "expanded navigation keeps one brand label");
  assert.match(sidebarBrand, /<NovaLogo decorative className="h-6 w-6" \/>/);
  assert.equal(sidebarBrand.replace(/<NovaLogo[^>]*\/>/, "").trim(), "KovaGPT");
  const railSource = sidebar.slice(
    sidebar.indexOf('aria-label="Collapsed navigation"'),
    sidebar.indexOf("<aside"),
  );
  const railLogo = openingTag(railSource, "NovaLogo", /decorative/);
  assert.match(railLogo, /className="h-6 w-6"/);
  assert.equal(
    (sidebar.match(/<NovaLogo\b/g) ?? []).length,
    2,
    "expanded navigation and collapsed rail each have one decorative owner mark",
  );
  assert.doesNotMatch(home, /<NovaLogo|kova-greeting-mark/);
  assert.match(publicSite, /<PublicShell>/);
  assert.doesNotMatch(publicSite, /<NovaLogo/);
  assert.match(openingTag(publicShell, "NovaLogo", /decorative/), /className="h-6 w-6"/);
  const footerLogo = openingTag(publicFooter, "NovaLogo", /decorative/);
  assert.match(footerLogo, /\bmark\b/);
  assert.match(footerLogo, /className="h-6 w-6"/);
  assert.match(seoLanding, /<PublicShell>/);
  assert.doesNotMatch(seoLanding, /<NovaLogo/);
  assert.match(pricing, /<PublicShell>/);
  assert.doesNotMatch(pricing, /<NovaLogo/);
  const recoveryLogo = openingTag(resetPassword, "NovaLogo", /\bmark\b/);
  assert.match(recoveryLogo, /className="mb-6 h-8 w-8"/);
  assert.doesNotMatch(
    recoveryLogo,
    /\bdecorative\b/,
    "the standalone recovery mark keeps its accessible name",
  );
  // Guest navigation uses the owner mark with the wordmark; the browser
  // contract verifies its decorative semantics and fetches the real asset.
  assert.match(uiQuality, /await expect\(sidebarBrand\)\.toHaveText\("KovaGPT"\)/);
  assert.match(uiQuality, /sidebarBrand\.locator\("img"\)\)\.toHaveCount\(1\)/);
  assert.match(uiQuality, /const ownerAsset = await page\.request\.get\("\/kova-logo\.png"\)/);
  assert.match(uiQuality, /expect\(ownerAsset\.ok\(\)\)\.toBe\(true\)/);
  assert.match(uiQuality, /ownerAsset\.headers\(\)\["content-type"\]\)\.toContain\("image\/png"\)/);
  assert.match(
    uiQuality,
    /expect\(\(await ownerAsset\.body\(\)\)\.byteLength\)\.toBeGreaterThan\(0\)/,
  );
});

test("canonical reference styles own shell and composer contracts without retired layers", () => {
  const imports = [];
  postcss.parse(styles).walkAtRules("import", (rule) => imports.push(rule.params));
  for (const file of [
    "core-system.css",
    "sidebar-core.css",
    "composer-core.css",
    "spec400-chat.css",
    "visual-tokens.css",
    "control-geometry.css",
    "reference-surfaces.css",
    "workspace-layout.css",
  ]) {
    assert.equal(
      imports.filter((value) => value === `"./styles/${file}"`).length,
      1,
      `${file} is imported once`,
    );
  }
  for (const file of [
    "chatgpt-parity.css",
    "chatgpt-final-parity.css",
    "assistant.css",
    "assistant-modern.css",
  ]) {
    assert.ok(!imports.some((value) => value.includes(file)), `${file} must remain retired`);
    assert.doesNotMatch(runtime, new RegExp(file.replaceAll(".", "\\.")));
  }
  assert.ok(
    imports.indexOf('"./styles/spec400-chat.css"') >
      imports.indexOf('"./styles/composer-core.css"'),
  );
  assert.doesNotMatch(styles, /@import "\.\/styles\/core-workspace\.css";/);
  assert.doesNotMatch(
    styles,
    /DAY10 composer focus contract|FINAL composer keyboard focus contract/,
  );

  // Shared legacy utilities cannot take geometry or a permanent outline back
  // from the scoped composer, sidebar and empty-page owners.
  postcss.parse(styles).walkRules((rule) => {
    assert.doesNotMatch(
      rule.selector,
      /\.(?:kova-composer|spec400-composer|kova-sidebar|kova-empty-chat)(?![-\w])/,
    );
  });
  const surface = declarations(composerStyles, ".spec400-composer");
  assert.equal(surface.display, "flex");
  assert.equal(surface["flex-direction"], "column");
  assert.equal(surface["grid-template-columns"], undefined);
  assert.equal(surface["grid-template-areas"], undefined);
  assert.equal(surface["min-height"], "148px");
  assert.equal(surface["border-radius"], "var(--kova-radius-composer, 26px)");
  assert.equal(surface.background, "var(--composer-background, var(--surface-secondary))");
  assert.equal(surface.outline, undefined, "an idle composer has no permanent outline");
  assert.equal(
    declarations(composerStyles, '.spec400-composer[data-focus-origin="keyboard"]:focus-within')
      .outline,
    "2px solid var(--ring)",
  );
  const send = declarations(composerStyles, ".spec400-send-button");
  for (const key of ["width", "height", "min-width", "min-height"]) assert.equal(send[key], "36px");
  assert.equal(send["border-radius"], "50%");
  const phone = declarations(
    composerStyles,
    ".spec400-composer",
    "(max-width: 1023px), (any-pointer: coarse)",
  );
  assert.equal(phone.display, "flex");
  assert.equal(phone["flex-direction"], "column");
  const touchSend = declarations(
    composerStyles,
    ".spec400-send-button",
    "(max-width: 1023px), (any-pointer: coarse)",
  );
  for (const key of ["width", "height", "min-width", "min-height"])
    assert.equal(touchSend[key], "44px");

  assert.match(message, /import "\.\/response-action-refinement\.css";/);
  const actionSelector =
    ":is(.kova-assistant, .kova-project-chat) .kova-message-actions.kova-response-action-bar button.kova-message-icon-action";
  const compactAction = declarations(responseStyles, actionSelector);
  const touchAction = declarations(
    responseStyles,
    actionSelector,
    "(any-pointer: coarse), (max-width: 1023px)",
  );
  for (const key of ["width", "height", "min-width", "min-height"]) {
    assert.equal(compactAction[key], "32px");
    assert.equal(touchAction[key], "44px");
  }
  assert.equal(declarations(responseStyles, ".kova-message-actions")["flex-wrap"], "nowrap");
  assert.match(message, /kova-response-action-bar[^"\n]*overflow-x-auto/);
  assert.match(message, /kova-open-result-action[^"\n]*shrink-0[^"\n]*whitespace-nowrap/);
  assert.equal(declarations(menuStyles, ".kova-composer-menu").background, "var(--popover)");

  const coreStart = styles.indexOf("/* Core workspace overhaul:");
  const coreEnd = styles.indexOf("/* End core workspace overhaul.");
  assert.ok(
    coreStart >= 0 && coreEnd > coreStart,
    "the remaining shared utility section stays bounded",
  );
  assert.equal((styles.match(/\/\* Core workspace overhaul:/g) ?? []).length, 1);
  const trailingStyles = styles.slice(styles.indexOf("*/", coreEnd) + 2);
  const trailingRules = postcss
    .parse(trailingStyles)
    .nodes.filter((node) => node.type !== "comment");
  assert.ok(trailingRules.every((node) => node.type === "rule"));
  assert.deepEqual(
    trailingRules.map((rule) => rule.selector.replace(/\s+/g, "")),
    [
      '[role="dialog"]forminput.border-input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"])',
      '[role="dialog"]form:is(label,div:has(>label)):has(+:is(input.border-input,textarea.border-input))',
      '[role="dialog"]formlabel>:is(input.border-input,textarea.border-input)',
    ],
    "only scoped dialog-field repairs may follow the shared utilities",
  );
});

test("composer focus, menu placement, and truthful guest controls cannot regress", async () => {
  assert.doesNotMatch(composer, /outlineWidth:\s*"2px"/);
  assert.doesNotMatch(composer, /outlineColor:\s*"currentColor"/);
  assert.match(composer, /surface\?: "empty" \| "conversation"/);
  const syntax = ts.createSourceFile(
    "ChatInput.tsx",
    composer,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const positionedPopovers = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(syntax) === "PopoverContent")
      positionedPopovers.push(node.attributes.getText(syntax));
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  for (const className of ["kova-composer-menu spec400-attach-menu", "spec400-options-panel"]) {
    const popover = positionedPopovers.find((props) => props.includes(`className="${className}"`));
    assert.ok(popover, `${className} retains its positioned popover`);
    assert.match(popover, /side="top"/);
    assert.match(popover, /sideOffset=\{8\}/);
    assert.match(popover, /collisionPadding=\{12\}/);
  }
  assert.match(composer, /\{showAddMenu && isMobileLayout && \(\s*<MobileBottomSheet/);
  assert.match(composer, /ariaLabel="Attach files and tools"/);
  assert.match(
    composer,
    /restoreFocus=\{!contextOpen && !libraryOpen && !signInRequest && !optionsOpen\}/,
  );
  assert.match(composerStyles, /\.spec400-toolbar-button,[\s\S]*?min-height: 44px;/);
  assert.match(composer, /\["ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(event\.key\)/);
  assert.match(composer, /button:not\(:disabled\),a\[href\]/);
  assert.match(composer, /controls\[next\]\?\.focus\(\)/);
  assert.match(composer, /onKeyDown=\{handleMenuKeyDown\}/);
  assert.match(composer, /isComposing: Boolean\(native\.isComposing \|\| composingRef\.current\)/);
  const stopButton = openingTag(composer, "button", /aria-label="Stop generating"/);
  assert.match(stopButton, /type="button"/);
  assert.match(stopButton, /onClick=\{onStop\}/);
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
  assert.match(openingTag(home, "main", /id="main-content"/), /tabIndex=\{-1\}/);
  const boundaryMain = openingTag(states, "main", /data-app-error-boundary/);
  assert.match(boundaryMain, /id="main-content"/);
  assert.match(boundaryMain, /tabIndex=\{-1\}/);
  assert.match(boundaryMain, /className="kova-state-screen"/);
  assert.match(states, /data-app-error-boundary/);
  assert.match(states, /window\.location\.reload\(\)/);
  assert.match(states, /href="\/"/);
  assert.doesNotMatch(states, /incidentId|createIncidentId|app-error-reference/);
  assert.doesNotMatch(states, /description=\{this\.state\.error\.message\}/);
  const notFound = root.slice(
    root.indexOf("function NotFoundComponent()"),
    root.indexOf("function ErrorComponent"),
  );
  const routeError = root.slice(
    root.indexOf("function ErrorComponent"),
    root.indexOf("export const Route"),
  );
  for (const source of [notFound, routeError]) {
    const landmark = openingTag(source, "main", /id="main-content"/);
    assert.match(landmark, /tabIndex=\{-1\}/);
    assert.match(landmark, /className="kova-state-screen"/);
    assert.match(landmark, /data-ui-reference="chatgpt.error-state"/);
  }
  assert.match(notFound, /This page isn’t available/);
  assert.match(notFound, /window\.history\.back\(\)/);
  assert.match(notFound, /<Link to="\/"/);
  assert.match(routeError, /await router\.invalidate\(\)/);
  assert.match(routeError, /finally \{\s*reset\(\)/);
  assert.match(routeError, /href="\/"/);
  assert.doesNotMatch(routeError, /error\.message|incidentId|createIncidentId/);
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
