import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("src/styles.css", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const composer = await readFile("src/components/ChatInput.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");

test("shared interaction styles cover composer, menus, motion, and narrow phones", () => {
  assert.match(styles, /\.kova-composer:focus-within/);
  assert.match(styles, /\[role="menuitem"\]:focus-visible/);
  assert.match(styles, /@media \(max-width: 359px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(home, /kova-mobile-starters/);
  assert.match(home, /kova-capability-card/);
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

test("streaming status reports only real activity instead of invented progression", () => {
  assert.match(message, /let label = "Thinking"/);
  assert.doesNotMatch(message, /IDLE_STATUSES|Planning response|Finishing response/);
  assert.match(message, /kova-thinking-indicator/);
});
