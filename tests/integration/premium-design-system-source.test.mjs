import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const styles = await readFile("src/styles.css", "utf8");
const shell = await readFile("src/components/AppShell.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");

test("professional design system uses a restrained single-accent palette", () => {
  assert.match(styles, /--kova-blue:/);
  assert.match(styles, /--kova-violet: var\(--kova-blue\)/);
  assert.match(styles, /--gradient-kova: var\(--kova-blue\)/);
  assert.match(styles, /\.dark\s*\{[\s\S]*color-scheme: dark/);
});

test("keyboard focus and overflow-sensitive rich content remain usable", () => {
  assert.match(styles, /:focus-visible\s*\{/);
  assert.match(styles, /outline: 2px solid var\(--ring\)/);
  assert.match(styles, /\.kova-table-scroll[\s\S]*overflow-x: auto/);
  assert.match(styles, /\.prose-chat pre[\s\S]*overflow-x: auto/);
  assert.match(styles, /max-width: calc\(100vw - 2rem\)/);
});

test("shell removes decorative workspace mesh and sidebar uses blue selection indicator", () => {
  assert.doesNotMatch(shell, /className="kova-bg"/);
  assert.match(sidebar, /bg-\[var\(--kova-blue\)\]/);
  assert.match(sidebar, /group-focus-within:opacity-100/);
  assert.doesNotMatch(sidebar, /new CustomEvent\("kova-open-lens"\)/);
  assert.doesNotMatch(styles, /button\[aria-label="Open Kova Lens"\]\.fixed/);
});
