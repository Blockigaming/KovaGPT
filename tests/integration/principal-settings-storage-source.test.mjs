import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("settings wait for an authenticated principal and never render stale account state", async () => {
  const [home, root, images, shell, hook] = await Promise.all([
    read("src/routes/index.tsx"),
    read("src/routes/__root.tsx"),
    read("src/routes/images.tsx"),
    read("src/components/AppShell.tsx"),
    read("src/lib/use-nova-settings.ts"),
  ]);

  assert.doesNotMatch(home, /useState\([^\n]*loadSettings\(null/);
  assert.match(
    home,
    /if \(!isLoaded\) \{\s*setConversationState\(\{ principal: null, items: \[\] \}\)/,
  );
  assert.match(home, /loadSettings\(userKey, \{ migrateLegacyGuest: userKey === null \}\)/);

  assert.match(root, /applyThemeMode\(loadThemeMode\(\)\)/);
  assert.match(
    root,
    /if \(!isLoaded\) return;\s*const loaded = loadSettings\(userKey, \{\s*migrateLegacyGuest: userKey === null/,
  );
  assert.doesNotMatch(root, /loadSettings\(null\)/);

  assert.match(images, /useNovaSettings\(userKey, isLoaded\)/);
  assert.match(shell, /useNovaSettings\(userKey, isLoaded\)/);
  assert.doesNotMatch(shell, /setSettings\(DEFAULT_SETTINGS\)/);
  assert.match(hook, /principalResolved \? settingsKey\(userKey\) : null/);
  assert.match(hook, /state\.principal === principal \? state\.settings : DEFAULT_SETTINGS/);
  assert.match(hook, /principalRef\.current !== principal/);
  assert.match(hook, /saveStoredSettings\(userKey, state\.settings\)/);
});

test("the legacy settings fallback is gated to an explicit guest migration", async () => {
  const storage = await read("src/lib/settings-storage.ts");
  const guestGate = storage.indexOf(
    "userKey === null && migrateLegacyGuest ? SETTINGS_KEY_BASE : null",
  );
  const legacyGuard = storage.indexOf("if (legacyKey === null) return null;");
  const legacyRead = storage.indexOf("localStorage.getItem(legacyKey)");

  assert.ok(guestGate >= 0);
  assert.ok(legacyGuard >= 0);
  assert.ok(legacyRead > legacyGuard);
  assert.match(
    storage,
    /const legacy = parseSettingsRecord\(legacyRaw\);\s*if \(legacy === null\) return null/,
  );
  assert.match(
    storage,
    /localStorage\.setItem\(scopedKey, legacyRaw\);\s*localStorage\.removeItem\(legacyKey\)/,
  );
});

test("account, memory, and local-device deletion keep their storage scopes distinct", async () => {
  const [settings, home, images] = await Promise.all([
    read("src/components/SettingsDialog.tsx"),
    read("src/routes/index.tsx"),
    read("src/routes/images.tsx"),
  ]);

  assert.match(
    settings,
    /clearPrincipalChatStorage\(userKey\);\s*clearPrincipalPreferences\(userKey\);\s*onClearAll\(\);\s*setDeleteAccountOpen/,
  );
  assert.match(
    settings,
    /deleteSavedMemoryAfterDraining\(\{[\s\S]{0,500}authFetch\("\/api\/memory", \{ method: "DELETE" \}\)/,
  );
  assert.doesNotMatch(settings, /All conversation memory cleared/);
  assert.match(
    settings,
    /clearPrincipalChatStorage\(userKey\);\s*clearPrincipalPreferences\(userKey\);\s*onChange\(DEFAULT_SETTINGS\);\s*onClearAll\(\);\s*toast\.success\("Local storage cleared\."\)/,
  );
  assert.match(
    settings,
    /<WorkspaceDefaults userKey=\{userKey\} principalResolved=\{isLoaded\} \/>/,
  );
  assert.match(settings, /<LocationPanel userKey=\{userKey\} principalResolved=\{isLoaded\} \/>/);
  assert.doesNotMatch(
    settings,
    /localStorage\.getItem\("kova-(?:workspace-defaults-v1|location)"\)/,
  );
  assert.doesNotMatch(settings, /localStorage\.setItem\("kova-(?:workspace-defaults-v1|location)"/);

  assert.match(
    home,
    /onClearAll=\{\(\) => \{\s*setConversations\(\[\]\);\s*setActiveId\(null\);\s*setInput\(""\);\s*setAttachments\(\[\]\);\s*setEditingMessage\(null\)/,
  );
  assert.match(images, /if \(userKey\) localStorage\.removeItem\(HISTORY_KEY_PREFIX \+ userKey\)/);
  assert.doesNotMatch(images, /startsWith\("nova-gpt-conversations"\)/);
});
