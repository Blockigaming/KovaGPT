import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("src/styles.css", "utf8");
const coreStyles = await readFile("src/styles/core-workspace.css", "utf8");
const finalParityStyles = await readFile("src/styles/chatgpt-final-parity.css", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");
const root = await readFile("src/routes/__root.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const composer = await readFile("src/components/ChatInput.tsx", "utf8");
const modelSelector = await readFile("src/components/ResponsiveModelSelector.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const states = await readFile("src/components/states.tsx", "utf8");
const runtime = await readFile("src/components/PlatformRuntime.tsx", "utf8");

test("shared interaction styles cover composer, menus, motion, and narrow phones", () => {
  assert.match(styles, /\.kova-composer:focus-within/);
  assert.match(styles, /\[role="menuitem"\]:focus-visible/);
  assert.match(styles, /@media \(max-width: 359px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
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
});

test("the core workspace layer owns shell and composer visual contracts", () => {
  assert.match(styles, /@import "\.\/styles\/chatgpt-parity\.css";/);
  assert.match(styles, /@import "\.\/styles\/chatgpt-final-parity\.css";/);
  assert.match(styles, /@import "\.\/styles\/core-workspace\.css";/);
  assert.ok(
    styles.indexOf("chatgpt-final-parity.css") < styles.indexOf("core-workspace.css"),
    "core workspace styles must load after the compatibility layers",
  );
  assert.doesNotMatch(runtime, /chatgpt-final-parity\.css/);
  assert.equal(
    (coreStyles.match(/Core workspace overhaul/g) ?? []).length,
    1,
    "one authoritative core workspace layer should remain",
  );
  assert.doesNotMatch(
    styles,
    /DAY10 composer focus contract|FINAL composer keyboard focus contract/,
  );
  assert.match(coreStyles, /\.kova-composer\s*\{/);
  assert.match(coreStyles, /\.kova-composer:focus-within/);
  assert.match(finalParityStyles, /\.kova-composer:focus-within/);
  assert.match(finalParityStyles, /grid-template-columns: 44px minmax\(0, 1fr\) auto !important/);
});

test("composer focus, menu placement, and truthful guest controls cannot regress", () => {
  assert.doesNotMatch(composer, /outlineWidth:\s*"2px"/);
  assert.doesNotMatch(composer, /outlineColor:\s*"currentColor"/);
  assert.match(composer, /surface\?: "empty" \| "conversation"/);
  assert.match(composer, /top-\[calc\(100%\+1\.25rem\)\]/);
  assert.match(composer, /bottom-\[calc\(100%\+1\.25rem\)\]/);
  assert.match(composer, /mobile \? "min-h-14[^"\n]+" : "min-h-11/);
  assert.match(home, /surface="empty"/);
  assert.match(home, /EMPTY_STATE_STARTERS/);
  assert.match(home, /setInput\(\(current\)/);
  assert.match(modelSelector, /kova-model-static/);

  const lockedBranch = modelSelector.match(/if \(locked\)[\s\S]*?<\/span>\s*\);/)?.[0] ?? "";
  assert.ok(lockedBranch, "locked model branch should remain explicit");
  assert.doesNotMatch(lockedBranch, /ChevronDown|pointer-events-none|aria-hidden/);
  assert.match(sidebar, /"Maps", Map, isOn\("\/maps"\), "Preview"/);
  assert.doesNotMatch(sidebar, /"Maps", Map, isOn\("\/maps"\), "New"/);
});

test("shell error and not-found states use safe copy, landmarks, and real recovery", () => {
  assert.match(home, /<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  assert.match(states, /<main id="main-content" className="kova-state-screen"/);
  assert.match(states, /data-app-error-boundary/);
  assert.match(states, /window\.location\.reload\(\)/);
  assert.match(states, /href="\/"/);
  assert.match(states, /Reference <code>\{this\.state\.incidentId\}<\/code>/);
  assert.doesNotMatch(states, /description=\{this\.state\.error\.message\}/);
  assert.match(root, /function NotFoundComponent\(\)[\s\S]*?<main id="main-content"/);
  assert.match(root, /We couldn't find that page/);
  assert.match(root, /function ErrorComponent[\s\S]*?className="kova-state-screen"/);
});

test("streaming status reports only real activity instead of invented progression", () => {
  assert.match(message, /let label = "Thinking"/);
  assert.doesNotMatch(message, /IDLE_STATUSES|Planning response|Finishing response/);
  assert.match(message, /kova-thinking-indicator/);
});
