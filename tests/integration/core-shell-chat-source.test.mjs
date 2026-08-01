import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const topbar = await readFile("src/components/MobileTopBar.tsx", "utf8");
const input = await readFile("src/components/ChatInput.tsx", "utf8");
const index = await readFile("src/routes/index.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");

test("sidebar uses a stable desktop width, hidden collapse, mobile drawer, and focus trap", () => {
  assert.match(sidebar, /const EXPANDED_WIDTH = 260/);
  assert.doesNotMatch(sidebar, /COLLAPSED_WIDTH/);
  assert.match(sidebar, /lg:!w-0 lg:border-r-0/);
  assert.match(sidebar, /min\(88vw,320px\)/);
  assert.match(sidebar, /document\.body\.style\.overflow = "hidden"/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(sidebar, /aria-label="Primary navigation"/);
  assert.match(sidebar, /aria-hidden=\{collapsed \? true : undefined\}/);
  assert.match(sidebar, /inert=\{collapsed \? true : undefined\}/);
  const order = [
    'aria-label="New chat"',
    ">Search</span>",
    '"/projects"',
    '"/library"',
    '"/images"',
    '"/apps"',
    '"/scheduled-tasks"',
  ];
  let cursor = -1;
  for (const marker of order) {
    const next = sidebar.indexOf(marker);
    assert.ok(next > cursor, `${marker} should appear after previous nav marker`);
    cursor = next;
  }
});

test("mobile header and sidebar controls meet touch and accessible-name contracts", () => {
  assert.match(topbar, /min-h-14/);
  assert.match(topbar, /w-11 h-11/);
  assert.match(topbar, /aria-label="Open menu"/);
  assert.match(sidebar, /aria-label="Collapse sidebar"/);
  assert.match(sidebar, /aria-label="Close navigation"/);
  assert.match(sidebar, /Close navigation menu/);
  assert.doesNotMatch(sidebar, /aria-label="Expand sidebar"/);
});

test("shared composer protects input, attachments, IME submission, and upload announcements", () => {
  assert.match(input, /composingRef/);
  assert.match(input, /native\.isComposing/);
  assert.match(input, /submittingRef/);
  assert.match(input, /MAX_IMAGE_FILE_BYTES/);
  assert.match(input, /handlePaste/);
  assert.match(input, /handleDrop/);
  assert.match(input, /aria-live="polite"/);
  assert.match(input, /status\?: "selected" \| "uploading" \| "complete" \| "failed"/);
  assert.match(input, /Retry \$\{a\.name\}/);
});

test("chat viewport only autoscrolls near bottom and exposes jump-to-latest", () => {
  assert.match(index, /nearBottomRef/);
  assert.match(index, /showJumpToLatest/);
  assert.match(index, /distance < 120/);
  assert.match(index, /Jump to latest/);
  assert.match(index, /onScroll=\{updateNearBottom\}/);
});

test("message component keeps reachable assistant actions and safe streaming states", () => {
  assert.match(message, /StreamingStatus/);
  assert.match(message, /onRetry/);
  assert.doesNotMatch(message, /readAloudSupported|speechSynthesis|Read response aloud|Volume2/);
  assert.match(message, /saveItem/);
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
  assert.match(index, /onTemporaryChatChange=\{setTemporaryChatEnabled\}/);
  assert.match(index, /aria-pressed=\{tempChat\}/);
  assert.match(index, /temporary: tempChat/);
  assert.match(index, /saveConversations\(conversations\.filter\(\(c\) => !c\.temporary\)\)/);
});

test("local-only message ratings make a local-only claim", () => {
  assert.match(message, /localStorage\.setItem\(feedbackKey, next\)/);
  assert.equal((message.match(/Rating saved on this device/g) ?? []).length, 2);
  assert.doesNotMatch(message, /Thanks for the feedback|Thanks, we'll improve/);
});
