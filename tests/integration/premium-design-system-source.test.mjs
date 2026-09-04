import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const styles = await readFile("src/styles.css", "utf8");
const shell = await readFile("src/components/AppShell.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");

test("brand accents remain available while the primary shell stays neutral", () => {
  const lightTheme = styles.match(/^:root\s*\{[\s\S]*?^\}/m)?.[0] ?? "";
  const darkTheme = styles.match(/^\.dark\s*\{[\s\S]*?^\}/m)?.[0] ?? "";

  assert.ok(lightTheme, "the canonical light theme block must exist");
  assert.ok(darkTheme, "the canonical dark theme block must exist");
  assert.equal((styles.match(/^:root\s*\{/gm) ?? []).length, 1);
  assert.equal((styles.match(/^\.dark\s*\{/gm) ?? []).length, 1);
  assert.equal((styles.match(/--surface-composer:/g) ?? []).length, 2);
  assert.match(lightTheme, /--kova-blue:/);
  assert.match(lightTheme, /--background: oklch\(1 0 0\)/);
  assert.match(lightTheme, /--foreground: oklch\(0\.19 0\.008 255\)/);
  assert.match(lightTheme, /--surface-workspace: var\(--background\)/);
  assert.match(lightTheme, /--surface-composer: oklch\(0\.982 0\.002 255\)/);
  assert.match(darkTheme, /color-scheme: dark/);
  assert.match(darkTheme, /--background: oklch\(0\.175 0\.004 255\)/);
  assert.match(darkTheme, /--foreground: oklch\(0\.965 0 0\)/);
  assert.match(darkTheme, /--surface-composer: oklch\(0\.225 0\.004 255\)/);
  assert.match(
    styles,
    /\.kova-topbar\s*\{[^}]*background: color-mix\(in oklab, var\(--background\) 92%, transparent\) !important;[^}]*box-shadow: 0 1px 0 color-mix\(in oklab, var\(--background\) 70%, transparent\) !important;[^}]*backdrop-filter: blur\(18px\) saturate\(130%\) !important;/s,
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
  assert.match(sidebar, /group-focus-within:opacity-100/);
  assert.doesNotMatch(sidebar, /new CustomEvent\("kova-open-lens"\)/);
  assert.doesNotMatch(styles, /button\[aria-label="Open Kova Lens"\]\.fixed/);
  assert.match(shell, /addEventListener\("kova-open-settings", handleOpenSettings\)/);
});
