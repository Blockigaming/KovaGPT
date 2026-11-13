import { SIDEBAR_ITEMS, DEFAULT_SIDEBAR_LAYOUT } from "../../src/lib/sidebar-layout.mjs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const topbar = await readFile("src/components/MobileTopBar.tsx", "utf8");
const input = await readFile("src/components/ChatInput.tsx", "utf8");
const index = await readFile("src/routes/index.tsx", "utf8");
const transcript = await readFile("src/components/ActiveChatTranscript.tsx", "utf8");
const temporaryControls = await readFile("src/components/TemporaryChatStartDialog.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const chatStore = await readFile("src/lib/chat-store.ts", "utf8");
const feedback = await readFile("src/lib/feedback.functions.ts", "utf8");
const feedbackBatch = await readFile("src/lib/feedback-batch.ts", "utf8");
const confirmDialog = await readFile("src/components/ConfirmActionDialog.tsx", "utf8");
const tokens = await readFile("src/styles/visual-tokens.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
function sidebarRule(selector, media) {
  const found = [];
  postcss.parse(sidebarStyles).walkRules(selector, (rule) => {
    if (
      media === undefined
        ? rule.parent.type === "root"
        : rule.parent.type === "atrule" &&
          rule.parent.name === "media" &&
          rule.parent.params === media
    )
      found.push(
        Object.fromEntries(
          rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
        ),
      );
  });
  assert.equal(found.length, 1, `one geometry owner for ${selector}`);
  return found[0];
}
test("sidebar uses a stable desktop width, compact rail, mobile drawer, and focus trap", () => {
  assert.match(sidebar, /data-kova-core-sidebar=""/);
  assert.match(tokens, /--kova-sidebar-width: 260px;/);
  assert.match(sidebar, /"--sidebar-expanded": `\$\{layout.width\}px`/);
  assert.equal(
    sidebarRule(".kova-sidebar[data-kova-core-sidebar]").width,
    "var(--sidebar-expanded, var(--kova-sidebar-width, 260px))",
  );
  assert.match(tokens, /--kova-sidebar-rail-width: 60px;/);
  assert.equal(
    sidebarRule(".kova-sidebar-rail[data-kova-core-rail]").width,
    "var(--kova-sidebar-rail-width, 60px)",
  );
  const closed = sidebarRule('.kova-sidebar[data-kova-core-sidebar][data-state="closed"]');
  assert.equal(closed.width, "0");
  assert.equal(closed["min-width"], "0");
  assert.equal(closed.visibility, "hidden");
  assert.equal(closed["pointer-events"], "none");
  assert.match(sidebar, /data-state=\{open \? "open" : "closed"\}/);
  assert.match(tokens, /--kova-sidebar-drawer-width: min\(86vw, 320px\);/);
  assert.equal(
    sidebarRule(".kova-sidebar[data-kova-core-sidebar]", "(max-width: 1023px)").width,
    "var(--kova-sidebar-drawer-width, min(86vw, 320px))",
  );
  assert.match(sidebar, /document\.body\.style\.overflow = "hidden"/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(sidebar, /aria-label="Primary navigation"/);
  assert.match(sidebar, /aria-hidden=\{collapsed \|\| workspaceSearchOpen \? true : undefined\}/);
  assert.match(sidebar, /inert=\{collapsed \|\| workspaceSearchOpen \? true : undefined\}/);
  assert.match(sidebar, />\s*Rename\s*</);
  assert.match(sidebar, /aria-label=\{`Options for \$\{conversation\.title\}`\}/);
  assert.match(sidebar, /sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)/);
  const defaultIds = DEFAULT_SIDEBAR_LAYOUT.shortcuts;
  for (const id of ["library", "projects", "scheduled-tasks", "apps"])
    assert.ok(defaultIds.includes(id), id);
  assert.ok(!defaultIds.includes("images"));
  assert.ok(!SIDEBAR_ITEMS.some((item) => item.id === "images"));
  assert.ok(!SIDEBAR_ITEMS.some((item) => item.id === "work"));
  assert.doesNotMatch(sidebar, /navLink\("\/work"/);
  assert.match(sidebar, /navLink\(item.to, item.label, SHORTCUT_ICONS\[id\]\)/);
  assert.match(
    sidebar,
    /cancelPendingSelection\(\);\s+closeAfterMobileNavigation\("\/"\);\s+onNew\(\);/,
  );
  assert.match(sidebar, /if \(!open \|\| !isMobileViewport\(\)\) return/);
  assert.match(sidebar, /navigationOwnsFocusRef\.current = requestDrawerNavigationFocus/);
  assert.match(sidebar, /closeAfterMobileNavigation\(to\)/);
  assert.equal(sidebarRule(".kova-sidebar[data-kova-core-sidebar]").margin, "0");
});

test("mobile header and sidebar controls meet touch and accessible-name contracts", () => {
  assert.match(topbar, /min-h-14/);
  const menuButton = topbar.match(/<Button\b[^>]*aria-label="Open menu"[^>]*>/u)?.[0] ?? "";
  const menuClasses = new Set(menuButton.match(/className="([^"]*)"/u)?.[1].split(/\s+/u));
  assert.ok(menuClasses.has("w-11"), "menu button must retain its 44px width");
  assert.ok(menuClasses.has("h-11"), "menu button must retain its 44px height");
  assert.match(topbar, /aria-label="Open menu"/);
  assert.match(sidebar, /aria-label="Collapse sidebar"/);
  assert.match(sidebar, /aria-label="Close sidebar"/);
  assert.match(sidebar, /Close navigation menu/);
  assert.match(sidebar, /Expand sidebar/);
});

test("shared composer protects input, attachments, IME submission, and upload announcements", () => {
  assert.match(input, /composingRef/);
  assert.match(input, /native\.isComposing/);
  assert.match(input, /submittingRef/);
  assert.match(input, /MAX_IMAGE_FILE_BYTES/);
  assert.match(input, /handlePaste/);
  assert.match(input, /handleDrop/);
  assert.match(input, /onDrop=\{handleDrop\}/);
  assert.match(input, /onDragOver=\{handleDragOver\}/);
  assert.match(
    input,
    /const handleDrop = async[\s\S]*?if \(disabled \|\| !showAddMenu\) return;\s*await addFiles\(files\)/,
  );
  assert.match(input, /dropEffect = "copy"/);
  assert.match(input, /aria-live="polite"/);
  assert.match(input, /status\?: "selected" \| "uploading" \| "complete" \| "failed"/);
  assert.match(input, /aria-label=\{`Inspect \$\{attachment\.name\}`\}/);
  assert.match(
    input,
    /previewAttachment\?\.status === "failed"[\s\S]*?removeAttachment\(index\)[\s\S]*?fileRef\.current\?\.click\(\)[\s\S]*?Choose file again/,
  );
  assert.match(input, /sendOnEnter/);
  assert.match(input, /Reconnect to send/);
  assert.match(input, /useSyncExternalStore/);
  assert.match(input, /const getOnlineStatusSnapshot = \(\) => navigator\.onLine !== false/);
  assert.match(input, /const getServerOnlineStatusSnapshot = \(\) => true/);
  assert.match(input, /const online = useSyncExternalStore\(/);
  assert.doesNotMatch(input, /typeof navigator === "undefined" \? true : navigator\.onLine/);
});

test("chat storage rejects malformed records and stays bounded", () => {
  assert.match(chatStore, /function isConversation/);
  assert.match(chatStore, /MAX_STORED_CONVERSATIONS = 500/);
  assert.match(chatStore, /MAX_MESSAGES_PER_CONVERSATION = 1_000/);
  assert.match(
    chatStore,
    /Array\.isArray\(parsed\) \? boundConversations\(parsed, userKey\) : \[\]/,
  );
  assert.match(chatStore, /Storage can be unavailable or full/);
  assert.match(chatStore, /subscribeToConversationChanges/);
});

test("response feedback is authenticated and durable rather than a decorative local control", () => {
  assert.match(feedback, /requireSupabaseAuth/);
  assert.match(feedback, /feedback_submissions/);
  assert.match(feedback, /duplicate_key/);
  assert.match(feedback, /createHash\("sha256"\)/);
  assert.match(feedback, /export const getResponseFeedbackBatch/);
  assert.match(feedback, /getResponseFeedbackBatch = createServerFn\(\{ method: "POST" \}\)/);
  assert.match(feedback, /\.max\(200\)/);
  assert.match(feedback, /\.in\("message_id", data\.messageIds\)/);
  assert.match(feedback, /expectedOwnerId !== actualOwnerId/);
  assert.match(feedback, /Your account changed\. Please try again\./);
});

test("destructive chat actions use an accessible confirmation dialog", () => {
  assert.match(confirmDialog, /AlertDialogContent/);
  assert.match(confirmDialog, /AlertDialogCancel/);
  assert.match(confirmDialog, /destructive/);
});

test("chat viewport only autoscrolls near bottom without a jump arrow", () => {
  assert.match(index, /nearBottomRef/);
  assert.doesNotMatch(index, /showJumpToLatest/);
  assert.match(transcript, /distance < 120/);
  assert.doesNotMatch(index, /Jump to latest/);
  assert.match(index, /<ActiveChatTranscript/u);
  assert.match(transcript, /onScroll=\{updateNearBottom\}/);
});

test("message component keeps reachable assistant actions and safe streaming states", () => {
  assert.match(message, /StreamingStatus/);
  assert.match(message, /onRetry/);
  // Local browser read-aloud is an accessibility aid, not full-duplex provider Voice.
  assert.doesNotMatch(message, /getUserMedia|MediaRecorder|voice_session/);
  assert.match(message, /saveItem/);
  assert.match(message, /aria-label="Response actions"/);
  assert.doesNotMatch(message, /aria-label="Good response"|aria-label="Bad response"/);
  assert.match(message, /<ResponseSpeechButton/);
  assert.match(message, /aria-label=\{copied \? "Copied" : "Copy response"\}/);
  assert.match(message, /aria-label="More actions"/);
  const toolbar = message.slice(
    message.indexOf('aria-label="Response actions"'),
    message.indexOf('aria-label="Response actions"') + 4200,
  );
  assert.equal((toolbar.match(/<DropdownMenuItem /g) ?? []).length, 2);
  assert.match(toolbar, /Try again/);
  assert.match(toolbar, /Branch into new chat/);
  assert.match(message, /aria-label="Share response"/);
  assert.match(message, /Save to Library/);
  assert.match(message, /MobileBottomSheet/);
  assert.match(message, /cleanAssistantText/);
});

test("temporary chat changes create a clean privacy boundary", () => {
  assert.match(index, /const activeTemporary = active \? Boolean\(active\.temporary\) : null/);
  assert.match(index, /if \(activeTemporary !== null\) setTempChat\(activeTemporary\)/);
  assert.match(index, /historyConversations = useMemo\([\s\S]*!conversation\.temporary/);
  assert.match(index, /setConversations\(\(previous\) =>[\s\S]*!conversation\.temporary/);

  const marker = index.indexOf("const setTemporaryChatEnabled");
  assert.notEqual(marker, -1);
  const toggle = index.slice(marker, marker + 1800);
  assert.match(toggle, /\(enabled: boolean\)/);
  assert.match(toggle, /newChat\(\)/);
  assert.match(toggle, /setTempChat\(enabled\)/);
  assert.ok(
    toggle.indexOf("newChat()") < toggle.indexOf("setTempChat(enabled)"),
    "the clean conversation boundary should be created before the privacy mode changes",
  );
  assert.match(
    index,
    /onTemporaryChatChange=\{\(enabled, trigger\) => \{\s*temporaryTriggerRef\.current = trigger;\s*temporaryReturnUrlRef\.current = window\.location\.href;\s*setTemporaryChatEnabled\(enabled\);/,
  );
  assert.match(index, /<TemporaryChatToggle[\s\S]*?enabled=\{tempChat\}/);
  assert.match(
    index,
    /onToggle=\{\(trigger\) => \{\s*temporaryTriggerRef\.current = trigger;\s*temporaryReturnUrlRef\.current = window\.location\.href;\s*setTemporaryChatEnabled\(!tempChat\);/,
  );
  assert.match(temporaryControls, /onClick=\{\(event\) => onToggle\(event\.currentTarget\)\}/);
  assert.match(temporaryControls, /aria-pressed=\{enabled\}/);
  assert.match(index, /temporary: tempChat/);
  assert.match(
    index,
    /saveConversations\(\s*userKey,\s*conversations\.filter\(\(c\) => !c\.temporary\)/,
  );
});

test("removed rating controls do not write feedback or claim model improvement", () => {
  assert.doesNotMatch(
    message,
    /useServerFn\(submitResponseFeedback\)|useServerFn\(getResponseFeedbackBatch\)/,
  );
  assert.doesNotMatch(
    message,
    /Rating saved on this device|Thanks for the feedback|Thanks, we'll improve/,
  );
});
