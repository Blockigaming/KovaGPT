import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("guest sign-in invitation is driven by conversation state after four prompts", async () => {
  const source = await read("src/routes/index.tsx");
  assert.match(source, /if \(!principalReady/);
  assert.match(source, /_retryAttempt === 0/);
  assert.match(source, /userMsgCount >= 4 && !isStreaming/);
});
test("Apps navigation and composer plugin entry are temporarily removed", async () => {
  const sidebar = await read("src/components/Sidebar.tsx");
  const composer = await read("src/components/ChatInput.tsx");
  const palette = await read("src/components/CommandPalette.tsx");
  assert.doesNotMatch(sidebar, /renderNavLink\("\/apps"/);
  assert.doesNotMatch(composer, /window\.location\.href = "\/apps"/);
  assert.doesNotMatch(palette, /Open Apps|href: "\/apps"/);
});
test("chat interaction primitives remain complete and animated", async () => {
  const input = await read("src/components/ChatInput.tsx");
  const message = await read("src/components/ChatMessage.tsx");
  const styles = await read("src/styles.css");
  assert.match(input, /Math\.min\(el\.scrollHeight, 200\)/);
  assert.match(input, /onStop/);
  assert.match(input, /onStop/);
  assert.match(message, /cursor-blink/);
  assert.match(message, /Copy code/);
  assert.match(styles, /kova-sidebar/);
  assert.match(styles, /--surface-modal: var\(--popover\)/);
  assert.match(styles, /backdrop-filter: none/);
});
test("assistant response contract covers implicit formatting and honest correction", async () => {
  const modes = await read("src/lib/modes.ts");
  for (const phrase of [
    "compact Markdown table",
    "correct language identifier",
    "Correct a false premise",
    "strongest relevant perspectives",
    "human feelings",
  ])
    assert.match(modes, new RegExp(phrase));
});
