import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
const styles = readFileSync("src/styles/composer-core.css", "utf8");
const chatStyles = readFileSync("src/styles/spec400-chat.css", "utf8");

test("desktop Attach prefers above the composer and retains collision bounds", () => {
  assert.match(
    composer,
    /className="kova-composer-menu spec400-attach-menu"\s+side="top"\s+align="start"\s+sideOffset=\{8\}\s+collisionPadding=\{12\}/,
  );
});

test("composer menus own scrolling without a nested plugin scroll region", () => {
  const menu = styles.match(/\.kova-composer-menu\s*\{([^}]+)\}/)?.[1];
  assert.ok(menu);
  assert.match(
    menu,
    /max-height: min\(36rem, var\(--radix-popover-content-available-height, 80vh\)\)/,
  );
  assert.match(menu, /overflow-y: auto/);
  assert.match(menu, /overscroll-behavior: contain/);
  assert.doesNotMatch(styles, /\.kova-composer-plugin-list\s*\{[^}]*(?:overflow|max-height)/);
  assert.match(styles, /\.kova-composer-plugins\s*\{[^}]*border-top:/);
});

test("phone Attach keeps its separate bottom-sheet actions", () => {
  assert.match(composer, /showAddMenu && isMobileLayout && \(\s*<MobileBottomSheet/);
  assert.match(composer, /renderComposerActions\(true\)/);
});

test("phone composer stays touch-sized and grows for multiline text or attachments", () => {
  const phone = chatStyles.slice(
    chatStyles.indexOf("@media (max-width: 1023px), (any-pointer: coarse)"),
  );
  assert.match(phone, /\.spec400-composer\s*\{[^}]*display: flex;[^}]*min-height: 136px/);
  assert.match(phone, /\.spec400-composer-input\s*\{\s*min-height: 26px;\s*max-height: 144px/);
  assert.match(phone, /\.spec400-send-button\s*\{\s*min-width: 44px;\s*width: 44px/);
  assert.match(phone, /\.spec400-expand-input\s*\{[^}]*min-height: 44px/);
  const surface = chatStyles.match(/\.spec400-composer\s*\{([^}]+)\}/)?.[1];
  assert.ok(surface);
  assert.match(surface, /display: flex/);
  assert.match(surface, /min-height: 148px/);
  assert.doesNotMatch(surface, /(?:^|[;{]\s*)height:|overflow: hidden/);
  assert.match(chatStyles, /\.spec400-attachment-chips\s*\{[^}]*flex-wrap: wrap/);
  assert.match(chatStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(composer, /const limit = isMobileLayout \? 144 : 240/);
  assert.match(composer, /const minimum = 26/);
  assert.match(composer, /Math\.min\(Math\.max\(el\.scrollHeight, minimum\), limit\)/);
  assert.match(composer, /el\.style\.overflowY = el\.scrollHeight > limit \? "auto" : "hidden"/);
  assert.match(composer, /paddingBottom: `\$\{kbOffset \+ 8\}px`/);
});
