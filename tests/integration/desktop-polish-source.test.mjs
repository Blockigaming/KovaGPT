import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const input = await readFile("src/components/ChatInput.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const tokens = await readFile("src/styles/visual-tokens.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
const composerStyles = await readFile("src/styles/spec400-chat.css", "utf8");
const messageStyles = await readFile("src/components/response-action-refinement.css", "utf8");

test("desktop sidebar fully collapses and has one contained close trigger", () => {
  assert.match(tokens, /--kova-sidebar-width: 256px;/);
  assert.match(tokens, /--kova-sidebar-rail-width: 72px;/);
  assert.match(
    sidebarStyles,
    /\.kova-sidebar\[data-kova-core-sidebar\]\s*\{\s*width: var\(--kova-sidebar-width\);/,
  );
  assert.match(
    sidebarStyles,
    /\.kova-sidebar-rail\[data-kova-core-rail\]\s*\{\s*width: var\(--kova-sidebar-rail-width\);/,
  );
  assert.match(sidebar, /collapsed \? "lg:!w-0"/);
  assert.match(sidebar, /aria-label="Collapse sidebar"/);
  assert.match(sidebar, /aria-label="Expand sidebar"/);
  assert.match(sidebar, /inert=\{collapsed \? true : undefined\}/);
});

test("chat and composer use one stable readable measure", () => {
  assert.match(input, /className="spec400-composer"/);
  assert.doesNotMatch(input, /data-sidebar=closed.*max-w-\[52rem\]/);
  assert.doesNotMatch(message, /data-sidebar=closed.*max-w-\[52rem\]/);
  assert.match(tokens, /--kova-reading-width: 760px;/);
  assert.match(message, /kova-message-reading-column/);
  assert.match(message, /import "\.\/response-action-refinement\.css"/);
  assert.match(
    messageStyles,
    /\.kova-message-reading-column\s*\{[^}]*max-width: var\(--kova-reading-width\);/,
  );
  assert.match(
    composerStyles,
    /\.spec400-chat-input\s*\{[^}]*max-width: var\(--kova-reading-width\);/,
  );
});

test("desktop refinement stays breakpoint-scoped and preserves reduced motion", () => {
  assert.match(styles, /Desktop refinement layer/);
  assert.match(styles, /@media \(min-width: 1024px\)/);
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
