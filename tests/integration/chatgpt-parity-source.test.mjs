import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const [
  route,
  styles,
  appShell,
  sidebar,
  chatInput,
  chatMessage,
  modelSelector,
  responsiveSelector,
  mobileTopBar,
  searchServer,
  deepResearchServer,
  modes,
  workspaceModeSwitch,
  workRoute,
  onboarding,
] = await Promise.all([
  readFile("src/routes/index.tsx", "utf8"),
  readFile("src/styles.css", "utf8"),
  readFile("src/components/AppShell.tsx", "utf8"),
  readFile("src/components/Sidebar.tsx", "utf8"),
  readFile("src/components/ChatInput.tsx", "utf8"),
  readFile("src/components/ChatMessage.tsx", "utf8"),
  readFile("src/components/ModelSelector.tsx", "utf8"),
  readFile("src/components/ResponsiveModelSelector.tsx", "utf8"),
  readFile("src/components/MobileTopBar.tsx", "utf8"),
  readFile("src/lib/ai/search.server.ts", "utf8"),
  readFile("src/lib/ai/deep-research.server.ts", "utf8"),
  readFile("src/lib/modes.ts", "utf8"),
  readFile("src/components/WorkspaceModeSwitch.tsx", "utf8"),
  readFile("src/routes/work.tsx", "utf8"),
  readFile("src/components/OnboardingDialog.tsx", "utf8"),
]);

test("signed-in users can move clearly between Chat and Work", () => {
  assert.match(workspaceModeSwitch, /aria-label="Primary workspace"/);
  assert.match(workspaceModeSwitch, /aria-current=\{active === "chat" \? "page" : undefined\}/);
  assert.match(workspaceModeSwitch, /aria-current=\{active === "work" \? "page" : undefined\}/);
  assert.match(route, /<WorkspaceModeSwitch[\s\S]{0,160}active="chat"/);
  assert.match(workRoute, /<WorkspaceModeSwitch active="work"/);
  assert.match(sidebar, /renderNavLink\("\/work", "Work", BriefcaseBusiness\)/);
  assert.match(
    sidebar,
    /className="kova-sidebar-rail[\s\S]*?<Link\s+to="\/work"[\s\S]*?aria-label="Work"/,
  );
});

test("signed-in sidebar keeps core work visible and groups secondary destinations", () => {
  assert.match(sidebar, /aria-controls="sidebar-more-destinations"/);
  assert.match(sidebar, /aria-expanded=\{moreOpen\}/);
  assert.match(sidebar, /aria-label="More destinations"/);
  assert.match(sidebar, /if \(moreRouteActive\) setMoreOpen\(true\)/);
  assert.ok(
    sidebar.indexOf('renderNavLink("/work", "Work"') < sidebar.indexOf("More destinations"),
  );
  assert.ok(
    sidebar.indexOf('renderNavLink("/library", "Library"') < sidebar.indexOf("More destinations"),
  );
  assert.ok(
    sidebar.indexOf('renderNavLink("/apps", "Plugins"') > sidebar.indexOf("More destinations"),
  );
});

test("KovaGPT uses one ChatGPT-style model chooser in the top bar", () => {
  assert.match(route, /const greeting = "What can I help with\?";/);
  assert.match(chatInput, /KovaGPT can make mistakes\. Check important information\./);
  assert.doesNotMatch(route, /KovaGPT can make mistakes\. Check important info\./);
  assert.doesNotMatch(route, /ConversationOutline/);
  assert.equal((route.match(/canChangeAgent=\{false\}/g) ?? []).length, 2);
  assert.match(route, /<ResponsiveModelSelector[\s\S]{0,240}placement="topbar"/);
  assert.match(mobileTopBar, /<ResponsiveModelSelector[\s\S]{0,240}placement="topbar"/);
  assert.match(modelSelector, /ResponsiveModelSelector/);
  assert.match(responsiveSelector, /placement\?: "composer" \| "topbar"/);
  assert.equal((responsiveSelector.match(/data-testid="model-selector-trigger"/g) ?? []).length, 1);
  assert.match(responsiveSelector, /const useSheet = !isDesktop \|\| interaction === "touch"/);
  assert.match(responsiveSelector, /<MobileBottomSheet/);
  assert.match(responsiveSelector, /role="dialog"\s+aria-label="Choose model"/);
  assert.doesNotMatch(responsiveSelector, /return\s*\(\s*<ModelSelector/);
});

test("signed-in empty chat removes guest-only onboarding clutter", () => {
  assert.match(route, /\{isLoaded && !isSignedIn \? \(\s*<div className="kova-greeting-mark"/);
  assert.match(
    route,
    /\{isLoaded && !isSignedIn \? \(\s*<p className="max-w-md[\s\S]*?Think through a question/,
  );
  assert.match(
    route,
    /\{isLoaded && !isSignedIn \? \(\s*<Suspense[\s\S]*?<HomeChatStarters setInput=\{setInput\}/,
  );
});

test("signed-in onboarding hands real choices to the authenticated composer", () => {
  assert.match(onboarding, /if \(!primaryUse \|\| !user\?\.id\) return/);
  assert.match(onboarding, /const initiatingOwnerId = user\.id/);
  assert.match(
    onboarding,
    /await persistOnboarding\(\);[\s\S]{0,100}ownerIdRef\.current !== initiatingOwnerId/,
  );
  assert.match(onboarding, /saveDraft\(initiatingOwnerId, null, starter\)/);
  assert.ok(
    onboarding.indexOf("await persistOnboarding();") <
      onboarding.indexOf("saveDraft(initiatingOwnerId, null, starter)"),
  );
  assert.doesNotMatch(onboarding, /localStorage\.setItem\("kova-draft:__new__"/);
  assert.match(onboarding, /onStarterSelected\?\.\(starter\)/);
  assert.match(onboarding, /onResponseLengthChange\?\.\(RESPONSE_LENGTH_BY_STYLE\[style\]\)/);
  assert.match(onboarding, /role="progressbar"/);
  assert.match(onboarding, /aria-pressed=\{primaryUse === u\.id\}/);
  assert.match(onboarding, /aria-pressed=\{style === s\.id\}/);
  assert.match(onboarding, /We couldn't save your choices/);
  assert.match(onboarding, /setPrimaryUse\(null\);[\s\S]{0,160}\}, \[user\?\.id\]\);/);
  assert.match(route, /<OnboardingDialog[\s\S]{0,320}onStarterSelected=\{\(starter\)/);
  assert.match(appShell, /<OnboardingDialog[\s\S]{0,240}onResponseLengthChange=/);
  assert.match(appShell, /saveStoredSettings\(userKey, next\)/);
});

test("active desktop chat keeps one primary action and groups secondary controls", () => {
  assert.match(route, /aria-label="Share chat"/);
  assert.match(route, /\{active \? \(\s*<>\s*\{isSignedIn \? \(\s*<button/);
  assert.match(route, /aria-label=\{[\s\S]*?"More chat actions, chat rules active"/);
  assert.match(route, /<DropdownMenuContent align="end" className="w-56">/);
  assert.match(
    route,
    /<DropdownMenuItem onSelect=\{\(\) => setWorkspaceOpen\(true\)\}>[\s\S]*?Chat settings/,
  );
  assert.match(route, /<Download className="mr-2 h-4 w-4" \/>[\s\S]*?Export chat/);
  assert.ok(route.indexOf('aria-label="Share chat"') < route.indexOf("More chat actions"));
});

test("composer actions, message editing, and markdown stay reachable and lossless", () => {
  assert.match(chatInput, /placeholder=\{placeholder \?\? "Ask anything"\}/);
  assert.match(
    chatInput,
    /spellCheck\s+autoComplete="off"\s+autoCorrect="on"\s+autoCapitalize="sentences"/,
  );
  assert.match(chatInput, /COMPOSER_TOOLS\.filter/);
  assert.match(chatInput, /tool\.id !== "deep_research" \|\| userTier !== "free"/);
  assert.match(chatInput, /\.map\(\s*toolRow,\s*\)/);
  assert.match(chatInput, /onToolSelect\?\.\(next\)/);
  assert.equal((route.match(/selectedTool=\{selectedTool\}/g) ?? []).length, 2);
  assert.match(chatInput, /kova-send-button is-enabled/);
  assert.match(chatMessage, /return text\.replace\(\/\\r\\n\?\/g, "\\n"\);/);
  assert.doesNotMatch(chatMessage, /LongResponseCard|shouldWrapAsDocument/);
  assert.match(route, /setInput\(m\.content\);/);
  assert.match(
    route,
    /setEditingMessage\(\{\s*conversationId: active\.id,\s*messageId: m\.id,\s*\}\);/,
  );
});

test("sending snapshots history and serializes automatic retries", () => {
  const snapshot = route.indexOf("const priorMessages =");
  const optimisticUpdate = route.indexOf("setConversations((prev) => {", snapshot);
  assert.ok(snapshot >= 0 && optimisticUpdate > snapshot);
  assert.match(route, /\|\| inFlightRef\.current\) return;/);
  assert.match(
    route,
    /const historyPayload = await createChatHistoryPayload\(\s*chatRequestMessages\(priorMessages, userMsg\)/,
  );
  assert.doesNotMatch(route, /\[\.\.\.priorMessages, userMsg\]\.map/);
  assert.match(route, /inFlightRef\.current = true;/);
  assert.match(route, /inFlightRef\.current = false;/);
  assert.match(route, /retryTimerRef\.current = window\.setTimeout/);
  assert.match(route, /window\.clearTimeout\(retryTimerRef\.current\)/);
  assert.match(route, /activeIdRef\.current !== nextConvId/);
  assert.match(route, /const retryHistory = active\.messages\.slice\(0, -2\);/);
  assert.match(route, /active\.id,\s+retryHistory,/);
  assert.doesNotMatch(route, /const attemptLabel|_Reconnecting…/);
});

test("web-backed answers keep exact clickable citations", () => {
  assert.doesNotMatch(chatMessage, /replace\(\/\\\[\\d\+\\\]\/g/);
  assert.match(searchServer, /Cite factual claims with Markdown links/);
  assert.match(searchServer, /Do not invent or alter URLs/);
  assert.match(deepResearchServer, /exact URL as a Markdown link/);
  assert.match(modes, /source-name Markdown links using the exact supplied URLs/);
});

test("the neutral shell has one theme layer and accessible collapsed navigation", () => {
  assert.equal((styles.match(/^:root\s*\{/gm) ?? []).length, 1);
  assert.equal((styles.match(/^\.dark\s*\{/gm) ?? []).length, 1);
  assert.match(styles, /--surface-workspace: var\(--background\);/);
  assert.match(
    styles,
    /\.kova-topbar\s*\{[^}]*background: color-mix\(in oklab, var\(--background\) 92%, transparent\) !important;[^}]*box-shadow: 0 1px 0 color-mix\(in oklab, var\(--background\) 70%, transparent\) !important;[^}]*backdrop-filter: blur\(18px\) saturate\(130%\) !important;/s,
  );
  assert.doesNotMatch(styles, /main button\.rounded-full/);
  assert.doesNotMatch(styles, /\[role=["']dialog["']\] button\.rounded-full/);
  assert.doesNotMatch(sidebar, /ActiveBar|bg-\[var\(--kova-blue\)\]/);
  assert.match(sidebar, /aria-hidden=\{collapsed \? true : undefined\}/);
  assert.match(sidebar, /inert=\{collapsed \? true : undefined\}/);
  assert.match(appShell, /addEventListener\("kova-open-settings", handleOpenSettings\)/);

  for (const source of [route, styles, appShell, sidebar, chatInput, chatMessage]) {
    assert.doesNotMatch(source, /^(?:<{7}|={7}|>{7})(?: .*)?$/m);
  }
});
