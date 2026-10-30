import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const styles = await readFile("src/styles.css", "utf8");
const shell = await readFile("src/components/AppShell.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const historySync = await readFile("src/components/ChatHistorySync.tsx", "utf8");
const tokens = await readFile("src/styles/visual-tokens.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");

test("brand accents remain available while the primary shell stays neutral", () => {
  const lightTheme = tokens.match(/^:root\s*\{[\s\S]*?^\}/m)?.[0] ?? "";
  const darkTheme = tokens.match(/^\.dark\s*\{[\s\S]*?^\}/m)?.[0] ?? "";

  assert.ok(lightTheme, "the canonical light theme block must exist");
  assert.ok(darkTheme, "the canonical dark theme block must exist");
  assert.equal((tokens.match(/^:root\s*\{/gm) ?? []).length, 1);
  assert.equal((tokens.match(/^\.dark\s*\{/gm) ?? []).length, 1);
  assert.equal((styles.match(/@import "\.\/styles\/visual-tokens\.css";/g) ?? []).length, 1);
  assert.equal((tokens.match(/--surface-composer:/g) ?? []).length, 2);
  assert.match(lightTheme, /--kova-blue: var\(--foreground\)/);
  assert.match(lightTheme, /--background: #ffffff/);
  assert.match(lightTheme, /--foreground: #0d0d0d/);
  assert.match(lightTheme, /--surface-workspace: var\(--background\)/);
  assert.match(lightTheme, /--surface-composer: #ffffff/);
  assert.match(darkTheme, /color-scheme: dark/);
  assert.match(darkTheme, /--background: #212121/);
  assert.match(darkTheme, /--foreground: #ffffff/);
  assert.match(darkTheme, /--surface-composer: #303030/);
  assert.match(
    sidebarStyles,
    /\.kova-topbar:not\(\.kova-desktop-topbar\)\s*\{[^}]*background: var\(--background\)/,
  );
});

test("keyboard focus and overflow-sensitive rich content remain usable", () => {
  assert.match(styles, /:focus-visible\s*\{/);
  assert.match(styles, /outline: 2px solid var\(--ring\)/);
  assert.match(styles, /\.kova-table-scroll[\s\S]*overflow-x: auto/);
  assert.match(styles, /\.prose-chat pre[\s\S]*overflow-x: auto/);
  assert.match(styles, /max-width: calc\(100vw - 2rem\)/);
});

test("shell removes decorative effects and keeps navigation neutral and reachable", () => {
  assert.doesNotMatch(shell, /className="kova-bg"/);
  assert.doesNotMatch(sidebar, /bg-\[var\(--kova-blue\)\]/);
  assert.match(sidebar, /aria-hidden=\{collapsed \? true : undefined\}/);
  assert.match(sidebar, /inert=\{collapsed \? true : undefined\}/);
  assert.match(
    sidebarStyles,
    /\.kova-sidebar \.kova-chat-row:is\(:hover, :focus-within, \.is-active\) \.kova-chat-options\s*\{\s*opacity: 1/,
  );
  assert.doesNotMatch(sidebar, /new CustomEvent\("kova-open-lens"\)/);
  assert.doesNotMatch(styles, /button\[aria-label="Open Kova Lens"\]\.fixed/);
  assert.match(shell, /addEventListener\("kova-open-settings", handleOpenSettings\)/);
});

test("selected account navigation is visible while healthy sync stays visually quiet", () => {
  assert.match(
    sidebarStyles,
    /\.kova-sidebar \.kova-nav-row:is\(\[aria-current="page"\], \.is-active\),\s*\.kova-sidebar \.kova-chat-row\.is-active\s*\{\s*background: var\(--sidebar-active\)/,
  );
  assert.match(historySync, /if \(!visible\)[\s\S]*?className="sr-only"/);
  assert.match(historySync, /rounded-xl border border-border\/70 bg-muted\/40/);
  assert.match(historySync, /role="status" aria-live="polite"/);
});
