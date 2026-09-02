import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const shell = await readFile("src/components/AppShell.tsx", "utf8");
const pricing = await readFile("src/routes/pricing.tsx", "utf8");
const images = await readFile("src/routes/images.tsx", "utf8");
const connect = await readFile("src/routes/connect.tsx", "utf8");

test("signed-out navigation stays focused and does not advertise unavailable Maps", () => {
  assert.doesNotMatch(sidebar, /renderNavLink\("\/maps"/);
  assert.doesNotMatch(sidebar, /SignInButton|SignUpButton/);
  assert.match(sidebar, /showSignedOut \? renderNavLink\("\/pricing", "Plans"/);
  assert.match(sidebar, /Start with KovaGPT/);
  assert.match(sidebar, /Sign in from the top bar/);
});

test("shared settings entry authenticates guests before rendering account settings", () => {
  assert.match(shell, /if \(isLoaded && !user\)/);
  assert.match(shell, /openSignIn\(\)/);
  assert.match(shell, /settingsOpen && user/);
});

test("pricing is a three-plan customer comparison with enterprise separated", () => {
  assert.match(pricing, /md:grid-cols-3/);
  assert.match(pricing, /Choose how far you want KovaGPT to go/);
  assert.match(pricing, /KovaGPT Enterprise/);
  assert.doesNotMatch(
    pricing,
    /Provider-dependent features require their services to be configured and available/,
  );
  assert.match(pricing, /Search, image generation, and Deep Research depend/);
});

test("Images leads with creation, curates styles, and preserves the full preset set", () => {
  assert.match(images, /What do you want to create\?/);
  assert.match(images, /const CURATED_STYLES = PRESETS\.slice\(0, 8\)/);
  assert.match(images, /const MORE_STYLES = PRESETS\.slice\(8\)/);
  assert.match(images, /Explore \{MORE_STYLES\.length\} more styles/);
  assert.match(images, /Your gallery starts here/);
  assert.match(images, /\/api\/generate-image/);
  assert.match(images, /saveGeneratedImage/);
  assert.match(images, /copyGeneratedImage/);
  assert.match(images, /removeFromHistory/);
});

test("Connect uses provider selection and keeps technical details behind disclosure", () => {
  assert.match(connect, /type ProviderId = "chatgpt" \| "claude" \| "claude-code" \| "other"/);
  assert.match(connect, /Choose your assistant/);
  assert.match(connect, /We will only show the setup steps for the option you choose/);
  assert.match(connect, /<details/);
  assert.match(connect, /Technical setup and refresh instructions/);
  assert.match(connect, /new URL\("\/mcp", window\.location\.origin\)/);
});
