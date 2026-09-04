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
]);

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
  assert.match(route, /const payloadMessages = \[\s*\.\.\.priorMessages\.map/);
  assert.match(route, /attachments: userMsg\.attachments/);
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
