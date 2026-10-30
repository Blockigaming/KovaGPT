import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const styles = read("src/styles.css");
const runtime = read("src/components/PlatformRuntime.tsx");
const system = read("src/styles/spec400-system.css");
const tokens = read("src/styles/visual-tokens.css");
const sidebar = read("src/components/Sidebar.tsx");
const mobileTopBar = read("src/components/MobileTopBar.tsx");

// The source contract follows the current reference foundation. Historical CSS
// files stay in Git history; loading them again would restore competing rules.
test("one reference foundation replaces historical parity override imports", () => {
  for (const retired of ["chatgpt-parity", "chatgpt-final-parity", "assistant", "assistant-modern"])
    assert.ok(!styles.includes(`@import "./styles/${retired}.css"`), retired);
  assert.doesNotMatch(styles, /@import "\.\/styles\/core-workspace\.css"/u);
  for (const active of [
    "sidebar-core",
    "composer-core",
    "spec400-chat",
    "visual-tokens",
    "control-geometry",
  ])
    assert.ok(styles.includes(`@import "./styles/${active}.css"`), active);
  assert.ok(
    styles.indexOf('@import "./styles/visual-tokens.css"') >
      styles.indexOf('@import "./styles/spec400-system.css"'),
    "canonical tokens follow the structural compatibility rules",
  );
  assert.match(tokens, /--font-sans:\s*var\(--font-ui\)/u);
  assert.match(tokens, /--font-display:\s*var\(--font-ui\)/u);
  assert.match(tokens, /--font-ui:[\s\S]*?ui-sans-serif,[\s\S]*?system-ui,/u);
  assert.match(tokens, /--font-reading:\s*Georgia,\s*"Times New Roman",\s*serif/u);
  assert.doesNotMatch(system, /--font-(?:sans|display):\s*["']/u);
  assert.match(system, /--font-sans:\s*var\(--font-ui,/u);
  assert.match(system, /--font-mono:\s*"IBM Plex Mono",\s*ui-monospace,\s*monospace/u);
  assert.doesNotMatch(runtime, /chatgpt-final-parity\.css/u);
  assert.doesNotMatch(
    styles,
    /\[role="dialog"\][^{]*:focus-visible[^{]*\{[^}]*background:\s*var\(--accent\)/u,
  );
});

test("current destinations and signed-out controls retain Kova branding", () => {
  for (const label of [
    "New chat",
    "Search",
    "Projects",
    "Scheduled tasks",
    "Library",
    "Connections",
  ])
    assert.match(sidebar, new RegExp(label, "u"));
  assert.match(sidebar, /Log in to view saved chats\./u);
  assert.match(sidebar, /<SignInButton mode="modal">/u);
  assert.match(sidebar, /Log in/u);
  assert.doesNotMatch(sidebar, /ChatGPT logo/u);
  assert.match(
    mobileTopBar,
    /<SignInButton mode="modal">[\s\S]*?<Button[\s\S]*?min-h-11[\s\S]*?text-background[\s\S]*?Log in/u,
  );
});

test("keyboard focus and reduced motion remain explicit in the active foundation", () => {
  const geometry = read("src/styles/control-geometry.css");
  const composer = read("src/styles/spec400-chat.css");
  assert.match(geometry, /:focus-visible[\s\S]*outline: 2px solid var\(--ring\)/u);
  assert.match(
    composer,
    /\.spec400-composer\[data-focus-origin="keyboard"\]:focus-within[\s\S]*outline: 2px solid var\(--ring\)/u,
  );
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(system, /prefers-reduced-motion/u);
});
