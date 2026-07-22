import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const topbar = await readFile("src/components/MobileTopBar.tsx", "utf8");
const input = await readFile("src/components/ChatInput.tsx", "utf8");
const index = await readFile("src/routes/index.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");

test("sidebar uses durable desktop widths, mobile drawer, focus trap, and required navigation order", () => {
  assert.match(sidebar, /const EXPANDED_WIDTH = 280/);
  assert.match(sidebar, /const COLLAPSED_WIDTH = 72/);
  assert.match(sidebar, /min\(88vw, 340px\)/);
  assert.match(sidebar, /document\.body\.style\.overflow = "hidden"/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(sidebar, /aria-label="Primary navigation"/);
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
  assert.match(sidebar, /aria-label=\{open \? "Collapse sidebar" : "Expand sidebar"\}/);
  assert.match(sidebar, /Close navigation menu/);
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
  assert.doesNotMatch(message, /readAloud|speechSynthesis|Read aloud|Volume2/);
  assert.match(message, /saveItem/);
  assert.match(message, /MobileBottomSheet/);
  assert.match(message, /cleanAssistantText/);
});
