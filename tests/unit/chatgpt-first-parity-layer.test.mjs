import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/styles.css", "utf8");
const runtime = readFileSync("src/components/PlatformRuntime.tsx", "utf8");
const parity = readFileSync("src/styles/chatgpt-final-parity.css", "utf8");
const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");

test("the final ChatGPT-first parity layer is loaded in every application route", () => {
  assert.match(styles, /@import "\.\/styles\/chatgpt-final-parity\.css"/u);
  assert.doesNotMatch(styles, /@import "\.\/styles\/core-workspace\.css"/u);
  assert.ok(
    styles.indexOf("/* Core workspace overhaul:") >
      styles.indexOf("/* Secondary workspace primitives:"),
    "the authoritative core layer must follow every compatibility rule",
  );
  assert.match(
    styles,
    /\/\* End core workspace overhaul\. Keep this section last in the stylesheet\. \*\/\s*$/u,
  );
  assert.doesNotMatch(runtime, /chatgpt-final-parity\.css/u);
  assert.match(parity, /\.kova-composer:focus-within[\s\S]*outline: 2px solid/u);
  assert.match(styles, /\/\* Core workspace overhaul:[\s\S]*\.kova-composer:focus-within/u);
  assert.match(parity, /\[data-chat-transcript\]/u);
  assert.match(parity, /min-width: 44px/u);
  assert.match(parity, /max-width: min\(58vw, 18rem\)/u);
});

test("current signed-out ChatGPT reference surfaces remain represented with Kova branding", () => {
  for (const label of ["New chat", "Search", "Images", "Plugins", "Deep research", "Maps"])
    assert.match(sidebar, new RegExp(label, "u"));
  assert.match(sidebar, /Get responses tailored to you/u);
  assert.doesNotMatch(sidebar, /OpenAI|ChatGPT logo/u);
});

test("sidebar and composer motion remain restrained and accessible", () => {
  assert.match(parity, /transform: none !important/u);
  assert.match(parity, /prefers-reduced-motion/u);
  assert.doesNotMatch(parity, /translateX\(/u);
});
