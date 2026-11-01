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
  modes,
  workspaceModeSwitch,
  workRoute,
  onboarding,
  shellSpec,
  headerActions,
  starters,
  modelStatus,
  tokens,
  sidebarStyles,
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
  readFile("src/lib/modes.ts", "utf8"),
  readFile("src/components/WorkspaceModeSwitch.tsx", "utf8"),
  readFile("src/routes/work.tsx", "utf8"),
  readFile("src/components/OnboardingDialog.tsx", "utf8"),
  readFile("tests/e2e/chatgpt-shell-parity.spec.ts", "utf8"),
  readFile("src/components/ConversationHeaderActions.tsx", "utf8"),
  readFile("src/components/HomeChatStarters.tsx", "utf8"),
  readFile("src/components/ComposerModelStatus.tsx", "utf8"),
  readFile("src/styles/visual-tokens.css", "utf8"),
  readFile("src/styles/sidebar-core.css", "utf8"),
]);

const homeView = await readFile("src/components/HomeChatStarters.tsx", "utf8");
const sidebarCatalog = await readFile("src/lib/sidebar-layout.mjs", "utf8");
test("chat stays primary and retired Work bookmarks do not expose a workspace switch", () => {
  assert.match(workspaceModeSwitch, /return null/);
  assert.doesNotMatch(mobileTopBar, /WorkspaceModeSwitch/);
  assert.match(workRoute, /throw redirect\(\{ to: "\/", replace: true \}\)/);
  assert.doesNotMatch(sidebarCatalog, /to: "\/work"/);
  assert.match(sidebar, /aria-label="New chat"/);
});

test("customizable core destinations precede the scrollable More disclosure", () => {
  const disclosure = sidebar.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(disclosure);
  assert.match(disclosure, /<summary[^>]*>[\s\S]*?<span>More<\/span>/);
  assert.doesNotMatch(disclosure, /navLink\("\/discovery", "Discover", Compass\)/);
  assert.match(disclosure, /Customize sidebar/);
  assert.doesNotMatch(disclosure, /navLink\("\/work"/);
  for (const path of ["/library", "/projects", "/apps", "/scheduled-tasks"])
    assert.ok(sidebarCatalog.includes('to: "' + path + '"'));
  assert.ok(
    sidebar.indexOf("navLink(item.to, item.label, SHORTCUT_ICONS[id])") <
      sidebar.indexOf(disclosure),
  );
});

test("secondary navigation remains discoverable without active unavailable destinations", () => {
  assert.match(sidebar, /data-ui-reference="gemini-sidebar-disclosure"/);
  assert.match(sidebar, /open=\{isOn\("\/maps"\) \|\| undefined\}/);
  assert.match(sidebar, /Expand sidebar/);
  assert.match(sidebar, /mapsReleaseApproved && railShortcuts.includes\("maps"\)/);
  assert.doesNotMatch(sidebar, /navLink\("\/(?:health|finances|work)"/);
});

test("Chat uses the current greeting and reports model availability truthfully", () => {
  assert.match(homeView, /const greeting = useHomeGreeting/);
  assert.match(chatInput, /KovaGPT can make mistakes\. Check important information\./);
  assert.doesNotMatch(route, /KovaGPT can make mistakes\. Check important info\./);
  assert.doesNotMatch(route, /ConversationOutline/);
  assert.equal((route.match(/canChangeAgent=\{!active\?\.kova\}/g) ?? []).length, 2);
  assert.doesNotMatch(route, /<ResponsiveModelSelector/);
  assert.doesNotMatch(mobileTopBar, /<ResponsiveModelSelector/);
  assert.match(
    chatInput,
    /<ComposerModelStatus visible=\{showModelStatus && isLoaded && Boolean\(user\)\}/,
  );
  assert.match(modelStatus, /aria-label="Model availability"/);
  assert.match(modelStatus, /Model selection isn’t available in this session/);
  assert.match(modelStatus, /The current serving model isn’t\s*confirmed/);
  assert.match(modelSelector, /ResponsiveModelSelector/);
  assert.match(responsiveSelector, /placement\?: "composer" \| "topbar"/);
  assert.equal((responsiveSelector.match(/data-testid="model-selector-trigger"/g) ?? []).length, 1);
  assert.match(responsiveSelector, /const useSheet = !isDesktop \|\| interaction === "touch"/);
  assert.match(responsiveSelector, /<MobileBottomSheet/);
  assert.match(responsiveSelector, /role="dialog"\s+aria-label="Choose model"/);
  assert.doesNotMatch(responsiveSelector, /return\s*\(\s*<ModelSelector/);
});

test("empty chat removes prompt examples and scopes recent work to signed-in history", () => {
  assert.doesNotMatch(route, /kova-greeting-mark/);
  assert.doesNotMatch(route, /Think through a question, shape an idea/);
  assert.doesNotMatch(homeView, /<HomeChatStarters|EMPTY_STATE_STARTERS/);
  for (const label of ["Write something", "Summarize a file", "Compare options"])
    assert.equal(starters.includes(label), false);
  assert.doesNotMatch(starters, /onSubmit|\.submit\(/);
  assert.match(route, /conversations=\{isLoaded && isSignedIn \? historyConversations : \[\]\}/);
  assert.match(homeView, /Continue working/);
  assert.doesNotMatch(route, /Sign in to save chats and attach files/);
  assert.match(route, /<SignInButton mode="modal">/);
});

test("signed-in onboarding hands real choices to the authenticated composer", () => {
  assert.match(onboarding, /if \(!primaryUse \|\| !user\?\.id\) return/);
  assert.match(onboarding, /const initiatingOwnerId = user\.id/);
  assert.match(
    onboarding,
    /await persistOnboarding\(\);[\s\S]{0,180}operationRef\.current !== operation/,
  );
  assert.match(onboarding, /saveDraft\(initiatingOwnerId, null, starter\)/);
  assert.ok(
    onboarding.indexOf("await persistOnboarding();") <
      onboarding.indexOf("saveDraft(initiatingOwnerId, null, starter)"),
  );
  assert.doesNotMatch(onboarding, /localStorage\.setItem\("kova-draft:__new__"/);
  assert.match(onboarding, /onStarterSelected\?\.\(starter\)/);
  assert.match(onboarding, /const responseLength = RESPONSE_LENGTH_BY_STYLE\[style\]/);
  assert.match(onboarding, /onResponseLengthChange\?\.\(responseLength\)/);
  assert.match(onboarding, /role="progressbar"/);
  assert.match(onboarding, /aria-pressed=\{primaryUse === u\.id\}/);
  assert.match(onboarding, /aria-pressed=\{style === s\.id\}/);
  assert.match(onboarding, /We couldn't save your choices/);
  assert.match(onboarding, /setPrimaryUse\(null\);[\s\S]{0,160}\}, \[user\?\.id\]\);/);
  assert.match(route, /<OnboardingDialog[\s\S]{0,320}onStarterSelected=\{\(starter\)/);
  assert.match(appShell, /<OnboardingDialog[\s\S]{0,240}onCompletion=/);
  assert.match(appShell, /saveStoredSettings\(userKey, next\)/);
  assert.match(appShell, /stageOnboardingHandoff\(completion\)/);
  assert.match(route, /consumeOnboardingHandoff\(userKey\)/);
  assert.match(
    onboarding,
    /const skip = async \(\) => \{[\s\S]{0,500}operationRef\.current = operation/,
  );
  assert.match(
    onboarding,
    /const skip = async \(\) => \{[\s\S]{0,900}finally \{[\s\S]{0,180}ownerIdRef\.current === initiatingOwnerId[\s\S]{0,100}operationRef\.current === operation/,
  );
});

test("active chat shares scoped header actions and keeps secondary controls reachable", () => {
  assert.doesNotMatch(shellSpec, /removeLocatorHandler\(onboarding\)/);
  assert.doesNotMatch(shellSpec, /onboarding\.waitFor\(\{ state: "visible", timeout: 10_000 \}\)/);
  assert.match(route, /active && chatStarted \? \(\s*<Suspense[\s\S]*?<ConversationHeaderActions/);
  assert.match(route, /key=\{`\$\{storagePrincipal\}:\$\{active\.id\}:\$\{compact\}`\}/);
  assert.match(route, /conversation=\{active\}/);
  assert.match(headerActions, /aria-label="Share chat"/);
  assert.match(headerActions, /if \(restrictedTemporary \|\| !signedIn\)/);
  assert.match(headerActions, /aria-label="More chat actions"/);
  assert.match(headerActions, /<DropdownMenuContent\s+align="end"/);
  assert.match(
    route,
    /onOpenContext=\{\(trigger\) =>[\s\S]*?new CustomEvent\("kova-open-message-context", \{ detail: \{ trigger \} \}\)/,
  );
  assert.match(chatInput, /addEventListener\("kova-open-message-context", openFromHeader\)/);
  assert.match(chatInput, /onOpenChatContext\(contextTriggerRef\.current\)/);
  assert.match(route, /const openChatWorkspace = [\s\S]{0,420}setWorkspaceOpen\(true\)/);
  assert.match(headerActions, /Export chat/);
  assert.match(
    headerActions,
    /new TextEncoder\(\)\.encode\(exportConversationMarkdown\(conversation\)\)/,
  );
  assert.match(headerActions, /safeDocumentFilename\(conversation\.title, "md"\)/);
  assert.match(
    route,
    /const conversations = principalReady \? conversationState\.items : EMPTY_CONVERSATIONS/,
  );
  assert.ok(
    headerActions.indexOf('aria-label="Share chat"') < headerActions.indexOf("More chat actions"),
  );
});

test("compact composer groups actions and preserves message editing and markdown", () => {
  assert.match(chatInput, /placeholder=\{placeholder \?\? "Describe what you need…"\}/);
  assert.match(
    chatInput,
    /spellCheck\s+autoComplete="off"\s+autoCorrect="on"\s+autoCapitalize="sentences"/,
  );
  assert.match(chatInput, /role="group" aria-label="Message tools"/);
  for (const label of ["Attach", "Context", "Options"])
    assert.ok(chatInput.includes(`aria-label="${label}"`));
  assert.match(chatInput, /renderComposerActions\(false\)/);
  assert.match(chatInput, /section !== "plugins" && \(\s*<div[^>]*aria-label="Attachment options"/);
  assert.match(chatInput, /section === "plugins" && \(\s*<ComposerPluginList/);
  assert.match(chatInput, /Open a project/);
  assert.match(chatInput, /setProjectPickerOpen\(true\)/);
  assert.match(chatInput, /chooseTool\(imageTool\)/);
  assert.match(chatInput, /aria-label="Response options"/);
  assert.doesNotMatch(chatInput, /deep_research/);
  assert.match(chatInput, /onToolSelect\?\.\(next\)/);
  assert.equal((route.match(/selectedTool=\{selectedTool\}/g) ?? []).length, 2);
  assert.match(chatInput, /disabled=\{!canSubmit\}\s+onClick=\{triggerSubmit\}/);
  assert.match(chatInput, /aria-label="Send message"/);
  assert.match(chatMessage, /return text\.replace\(\/\\r\\n\?\/g, "\\n"\);/);
  assert.doesNotMatch(chatMessage, /LongResponseCard|shouldWrapAsDocument/);
  assert.match(chatMessage, /"Retry response" : "Regenerate response"/);
  assert.match(
    chatMessage,
    /<DropdownMenuItem onSelect=\{onRetry\}>[\s\S]*?Retry\s*<\/DropdownMenuItem>/,
  );
  assert.match(chatMessage, /aria-label="Retry stopped response"/);
  assert.match(chatMessage, /label: retryActionLabel,[\s\S]*?onRetry\(\)/);
  assert.match(route, /setInput\(m\.content\);/);
  // The extracted edit helper also retains the unsent draft and its attachments.
  assert.match(
    route,
    /setEditingMessage\(\(previous\) =>\s*beginChatEdit\(\s*previous,\s*storagePrincipal,\s*active\.id,\s*m\.id,\s*input,\s*attachments\),/,
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
  assert.match(modes, /source-name Markdown links using the exact supplied URLs/);
});

test("the neutral shell has one theme layer and accessible collapsed navigation", () => {
  for (const owner of [
    "visual-tokens",
    "sidebar-core",
    "spec400-chat",
    "control-geometry",
    "assistant-overlays",
    "reference-surfaces",
  ])
    assert.equal(styles.split(`@import "./styles/${owner}.css";`).length - 1, 1, owner);
  assert.doesNotMatch(
    styles,
    /@import\s+["']\.\/styles\/(?:assistant|assistant-modern|chatgpt-parity|chatgpt-final-parity)\.css["']/,
  );
  assert.equal((styles.match(/^:root\s*\{/gm) ?? []).length, 0);
  assert.equal((styles.match(/^\.dark\s*\{/gm) ?? []).length, 0);
  assert.equal((tokens.match(/^:root\s*\{/gm) ?? []).length, 1);
  assert.equal((tokens.match(/^\.dark\s*\{/gm) ?? []).length, 1);
  const lightTheme = tokens.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1];
  const darkTheme = tokens.match(/^\.dark\s*\{([\s\S]*?)^\}/m)?.[1];
  assert.ok(lightTheme && darkTheme, "Both canonical theme scopes must exist");
  for (const theme of [lightTheme, darkTheme])
    assert.match(theme, /--surface-workspace: var\(--background\);/);
  const mobileBar = sidebarStyles.match(
    /\.kova-topbar:not\(\.kova-desktop-topbar\)\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(mobileBar, "The current mobile topbar must retain its scoped surface owner");
  assert.match(mobileBar, /background: var\(--background\);/);
  assert.doesNotMatch(mobileBar, /backdrop-filter|box-shadow/);
  assert.doesNotMatch(styles, /main button\.rounded-full/);
  assert.doesNotMatch(styles, /\[role=["']dialog["']\] button\.rounded-full/);
  assert.doesNotMatch(sidebar, /ActiveBar|bg-\[var\(--kova-blue\)\]/);
  const primaryNavigation = sidebar.match(/<aside\b[^>]*>/)?.[0];
  assert.ok(primaryNavigation, "The primary navigation landmark must remain present");
  assert.match(primaryNavigation, /id="kova-primary-navigation"/);
  assert.match(primaryNavigation, /aria-label="Primary navigation"/);
  assert.match(primaryNavigation, /aria-hidden=\{collapsed \? true : undefined\}/);
  assert.match(primaryNavigation, /inert=\{collapsed \? true : undefined\}/);
  assert.match(appShell, /addEventListener\("kova-open-settings", handleOpenSettings\)/);

  for (const source of [route, styles, appShell, sidebar, chatInput, chatMessage]) {
    assert.doesNotMatch(source, /^(?:<{7}|={7}|>{7})(?: .*)?$/m);
  }
});
