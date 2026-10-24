import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("guest sign-in invitation waits for three prompts in the current tab", async () => {
  const source = await read("src/routes/index.tsx");
  assert.match(source, /guestPromptTurns >= 3/);
  assert.match(source, /_retryAttempt === 0 && !isSignedIn/);
  assert.doesNotMatch(source, /userMsgCount >= 4/);
});
test("Apps navigation and composer connector entry are truthful and reachable", async () => {
  const sidebar = await read("src/components/Sidebar.tsx");
  const composer = await read("src/components/ChatInput.tsx");
  const palette = await read("src/components/CommandPalette.tsx");
  assert.match(sidebar, /navLink\("\/apps", "Plugins", PluginsGlyph\)/);
  assert.match(composer, /<ComposerPluginList/);
  const plugins = await read("src/components/ComposerPluginList.tsx");
  assert.match(plugins, /to="\/apps"/);
  assert.match(plugins, /preload=\{false\}/);
  assert.match(plugins, /navigationBlocked/);
  assert.doesNotMatch(palette, /Open Apps|href: "\/apps"/);
});
test("chat interaction primitives retain bounded input, Stop, copy and focus feedback", async () => {
  const input = await read("src/components/ChatInput.tsx");
  const message = await read("src/components/ChatMessage.tsx");
  const markdown = await read("src/components/ResponseMarkdown.tsx");
  const styles = await read("src/styles.css");
  const composerStyles = await read("src/styles/spec400-chat.css");
  assert.match(input, /const limit = isMobileLayout \? 144 : 240/);
  assert.match(input, /el\.style\.overflowY = el\.scrollHeight > limit \? "auto" : "hidden"/);
  assert.match(input, /onClick=\{onStop\}[\s\S]*?aria-label="Stop generating"/);
  assert.match(composerStyles, /\.spec400-toolbar-button:active,[^}]*background: var\(--muted\)/);
  assert.match(
    composerStyles,
    /\.spec400-send-button:focus-visible,[^}]*outline: 2px solid var\(--ring\)/,
  );
  assert.match(message, /cursor-blink/);
  assert.match(message, /<ResponseMarkdown/);
  assert.match(markdown, /kind=\{writing \? "text" : "code"\}/);
  assert.match(markdown, /`Copy \$\{kind\}`/);
  assert.match(markdown, /await writeClipboard\(text\)/);
  assert.match(styles, /kova-nav-icon/);
  assert.match(styles, /background: var\(--popover\)/);
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
