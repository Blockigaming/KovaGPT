import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const styles = await readFile("src/styles.css", "utf8");
const shell = await readFile("src/components/AppShell.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");

test("brand accents remain available while the primary shell stays neutral", () => {
  assert.match(styles, /--kova-blue:/);
  assert.match(styles, /--surface-workspace: var\(--background\)/);
  assert.match(styles, /--surface-composer: oklch\(0\.955 0\.002 255\)/);
  assert.match(
    styles,
    /\.kova-topbar\s*\{[^}]*background: var\(--background\) !important;[^}]*box-shadow: none !important;/s,
  );
  assert.match(styles, /\.dark\s*\{[\s\S]*color-scheme: dark/);
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
