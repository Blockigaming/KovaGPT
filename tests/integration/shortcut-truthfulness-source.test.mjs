import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shortcutsSource = await readFile(
  new URL("../../src/lib/shortcuts.ts", import.meta.url),
  "utf8",
);
const settingsSource = await readFile(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const shortcutPanel = settingsSource.slice(
  settingsSource.indexOf("function ShortcutsEditor"),
  settingsSource.indexOf("// ---------- Location panel ----------"),
);

test("stored shortcuts are validated before reaching the keyboard listener", () => {
  assert.match(shortcutsSource, /const parsed: unknown = JSON\.parse\(raw\);/);
  assert.match(shortcutsSource, /if \(!Array\.isArray\(parsed\)\) return DEFAULT_SHORTCUTS;/);
  assert.match(shortcutsSource, /KNOWN_SHORTCUT_IDS\.has\(candidate\.id as ShortcutId\)/);
  assert.match(shortcutsSource, /typeof candidate\.combo === "string"/);
  assert.match(shortcutsSource, /isValidShortcutCombo\(candidate\.combo\)/);
  assert.match(
    shortcutsSource,
    /new Set\(resolved\.map\(\(\{ combo \}\) => combo\)\)\.size === resolved\.length/,
  );
  assert.doesNotMatch(shortcutsSource, /JSON\.parse\(raw\) as Partial<Shortcut>\[\]/);
});

test("shortcut bindings are executable and collision-free", () => {
  assert.match(shortcutsSource, /if \(key === " "\) return "Space";/);
  assert.match(shortcutsSource, /if \(key === "\+"\) return "Plus";/);
  assert.match(
    shortcutsSource,
    /export function shortcutComboFromKeyboardEvent\([\s\S]*?normalizedShortcutKey\(event\.key\)/,
  );
  assert.match(
    shortcutsSource,
    /new Set\(saved\.map\(\(\{ combo \}\) => combo\)\)\.size !== saved\.length/,
  );
  assert.match(
    shortcutsSource,
    /return normalizedShortcutKey\(e\.key\)\.toLowerCase\(\) === key;/,
  );
  assert.match(
    shortcutPanel,
    /const conflict = visibleList\.find\([\s\S]*?shortcut\.combo === combo[\s\S]*?That shortcut is already assigned to/,
  );
  assert.match(shortcutPanel, /That key can't be used for a shortcut\./);
});

test("shortcut persistence reports unavailable or failed browser storage", () => {
  assert.match(
    shortcutsSource,
    /export function saveShortcuts\([\s\S]*?\): boolean \{[\s\S]*?if \(!key \|\| !principal \|\| !storage\) return false;/,
  );
  assert.match(
    shortcutsSource,
    /storage\.setItem\(key, JSON\.stringify\(saved\)\);[\s\S]*?return true;[\s\S]*?catch \{\s*return false;/,
  );
  assert.match(
    shortcutsSource,
    /export function resetShortcuts\([\s\S]*?\): boolean \{[\s\S]*?storage\.removeItem\(key\);[\s\S]*?return true;[\s\S]*?catch \{\s*return false;/,
  );
});

test("Settings commits shortcut state only after persistence succeeds", () => {
  assert.match(
    shortcutPanel,
    /if \(!mod\.saveShortcuts\(userKey, next\)\) \{[\s\S]*?Shortcut couldn't be saved in this browser\.[\s\S]*?return;[\s\S]*?setList\(next\);/,
  );
  assert.match(
    shortcutPanel,
    /if \(!mod\.resetShortcuts\(userKey\)\) \{[\s\S]*?Shortcuts couldn't be reset in this browser\.[\s\S]*?return;[\s\S]*?setList\(mod\.DEFAULT_SHORTCUTS\);/,
  );
  assert.match(shortcutPanel, /Shortcuts stay in this browser when storage is available/);
});

test("shortcut controls expose loading state and 44px touch targets", () => {
  assert.ok(shortcutPanel.includes("aria-busy={!ready}"));
  assert.match(shortcutPanel, /<p role="status"[\s\S]*?Loading shortcuts…/);
  assert.match(shortcutPanel, /disabled=\{!ready\}/);
  assert.ok((shortcutPanel.match(/min-h-11/g) ?? []).length >= 2);
  assert.match(shortcutPanel, /aria-label=/);
  assert.match(shortcutPanel, /Stop recording/);
});
