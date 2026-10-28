import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/styles.css", "utf8");
const runtime = readFileSync("src/components/PlatformRuntime.tsx", "utf8");
const parity = readFileSync("src/styles/chatgpt-final-parity.css", "utf8");
const system = readFileSync("src/styles/spec400-system.css", "utf8");
const tokens = readFileSync("src/styles/visual-tokens.css", "utf8");
const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
const mobileTopBar = readFileSync("src/components/MobileTopBar.tsx", "utf8");

test("shared compatibility styles remain loaded with the owner's authoritative specification", () => {
  assert.match(styles, /@import "\.\/styles\/chatgpt-final-parity\.css"/u);
  assert.doesNotMatch(styles, /@import "\.\/styles\/core-workspace\.css"/u);
  assert.ok(
    styles.indexOf("/* Core workspace overhaul:") >
      styles.indexOf("/* Secondary workspace primitives:"),
    "the authoritative core layer must follow every compatibility rule",
  );
  assert.ok(
    styles.indexOf('@import "./styles/spec400-system.css"') >
      styles.indexOf('@import "./styles/chatgpt-final-parity.css"'),
  );
  assert.match(styles, /@import "\.\/styles\/spec400-chat\.css"/u);
  assert.ok(
    styles.indexOf('@import "./styles/reference-surfaces.css"') >
      styles.indexOf('@import "./styles/spec400-system.css"'),
    "the current reference layer must follow legacy compatibility styles",
  );
  assert.match(
    system,
    /--font-sans:\s*var\(--font-ui,\s*ui-sans-serif,\s*system-ui,\s*sans-serif\)/u,
  );
  assert.match(
    system,
    /--font-display:\s*var\(--font-ui,\s*ui-sans-serif,\s*system-ui,\s*sans-serif\)/u,
  );
  assert.match(tokens, /--font-ui:\s*ui-sans-serif,\s*system-ui,/u);
  assert.match(tokens, /--font-reading:\s*Georgia,\s*"Times New Roman",\s*serif/u);
  assert.doesNotMatch(system, /--font-(?:sans|display):\s*"IBM Plex Sans"/u);
  assert.match(system, /--font-mono:\s*"IBM Plex Mono",\s*ui-monospace,\s*monospace/u);
  assert.match(
    system,
    /body \.kova-page textarea\.font-mono,[\s\S]*?font-family: "IBM Plex Mono", ui-monospace, monospace !important;/u,
  );
  assert.doesNotMatch(runtime, /chatgpt-final-parity\.css/u);
  assert.match(parity, /\.kova-composer:focus-within[\s\S]*outline: 2px solid/u);
  assert.match(styles, /\/\* Core workspace overhaul:[\s\S]*\.kova-composer:focus-within/u);
  assert.match(parity, /\[data-chat-transcript\]/u);
  assert.match(parity, /min-width: 44px/u);
  assert.match(parity, /max-width: min\(58vw, 18rem\)/u);
});

test("current primary destinations and signed-out controls retain Kova branding", () => {
  for (const label of [
    "New chat",
    "Search",
    "Chat",
    "Projects",
    "Scheduled tasks",
    "Library",
    "Plugins",
  ])
    assert.match(sidebar, new RegExp(label, "u"));
  assert.match(sidebar, /Log in to view saved chats\./u);
  assert.match(
    sidebar,
    /<SignInButton mode="modal">[\s\S]*?className="kova-sign-in[^"]*">\s*Log in\s*<\/button>/u,
  );
  assert.doesNotMatch(sidebar, /OpenAI|ChatGPT logo/u);
  assert.match(
    mobileTopBar,
    /<SignInButton mode="modal">[\s\S]*?min-h-11[\s\S]*?text-background[\s\S]*?Log in/u,
  );
});

test("sidebar and composer motion remain restrained and accessible", () => {
  assert.match(parity, /transform: none !important/u);
  assert.match(parity, /prefers-reduced-motion/u);
  assert.doesNotMatch(parity, /translateX\(/u);
});
