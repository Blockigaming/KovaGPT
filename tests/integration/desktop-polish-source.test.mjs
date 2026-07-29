import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const input = await readFile("src/components/ChatInput.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const styles = await readFile("src/styles.css", "utf8");

test("desktop sidebar rail has one contained trigger and deliberate widths", () => {
  assert.match(sidebar, /EXPANDED_WIDTH = 260/);
  assert.match(sidebar, /COLLAPSED_WIDTH = 64/);
  assert.match(sidebar, /aria-label="Expand sidebar"/);
  assert.match(sidebar, /collapsed \? \(/);
});

test("chat and composer use one stable readable measure", () => {
  assert.match(input, /kova-composer/);
  assert.doesNotMatch(input, /data-sidebar=closed.*max-w-\[52rem\]/);
  assert.doesNotMatch(message, /data-sidebar=closed.*max-w-\[52rem\]/);
  assert.match(message, /max-w-\[48rem\]/);
});

test("desktop refinement stays breakpoint-scoped and preserves reduced motion", () => {
  assert.match(styles, /Desktop refinement layer/);
  assert.match(styles, /@media \(min-width: 1024px\)/);
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
