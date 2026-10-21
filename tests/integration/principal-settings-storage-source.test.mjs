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
    /if \(!isLoaded\) \{[\s\S]{0,100}setConversationState\(\{ principal: null, items: \[\] \}\)/,
  );
  assert.match(home, /loadSettings\(userKey, \{ migrateLegacyGuest: userKey === null \}\)/);

  assert.match(root, /applyThemeMode\(loadThemeMode\(\)\)/);
  assert.match(
    root,
    /if \(!isLoaded\) return;\s*\/\/ Account notices and actions must not survive a principal transition\.\s*toast\.dismiss\(\);\s*const loaded = loadSettings\(userKey, \{\s*migrateLegacyGuest: userKey === null/,
  );
  assert.doesNotMatch(root, /loadSettings\(null\)/);

  assert.match(images, /useNovaSettings\(userKey, isLoaded\)/);
  assert.match(shell, /useNovaSettings\(userKey, isLoaded\)/);
  assert.doesNotMatch(shell, /setSettings\(DEFAULT_SETTINGS\)/);
  assert.match(hook, /principalResolved \? settingsKey\(userKey\) : null/);
  assert.match(
    hook,
    /state\.principal === principal &&[\s\S]{0,100}state\.generation === generationRef\.current/,
  );
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
  const [settings, home, images, policy] = await Promise.all([
    read("src/components/SettingsDialog.tsx"),
    read("src/routes/index.tsx"),
    read("src/routes/images.tsx"),
    read("src/lib/account-lifecycle-policy.mjs"),
  ]);

  const deletionStart = settings.indexOf("  const handleDeleteAccount = async () => {");
  const deletionEnd = settings.indexOf("  const handleClearSavedMemory = async () => {");
  assert.ok(deletionStart >= 0 && deletionEnd > deletionStart);
  const deletion = settings.slice(deletionStart, deletionEnd);
  const pendingStart = deletion.indexOf("    if (response.status !== 204) {");
  const finalCleanupStart = deletion.indexOf("    // Only a verified final 204");
  assert.ok(pendingStart > 0 && finalCleanupStart > pendingStart);
  const pending = deletion.slice(pendingStart, finalCleanupStart);

  assert.match(
    settings,
    /const clearLocalBrowserData = async \([\s\S]{0,180}targetUserKey[\s\S]{0,160}await resetPrincipalDeviceData\(targetUserKey\)/,
  );
  assert.match(
    deletion,
    /const deletionUserKey = userKey;[\s\S]*currentAuthUserKeyRef\.current === deletionUserKey &&[\s\S]*deletionOperationRef\.current === operation/,
  );
  assert.match(deletion, /requestAccountDeletion\(deletionUserKey, "DELETE"\)/);
  assert.match(pending, /response\.status === 202 && result\?\.state === "scheduled"/);
  assert.match(pending, /return;\s*\}\s*$/);
  assert.doesNotMatch(pending, /clearLocalBrowserData|onClearAll\(|signOut\(/);
  assert.match(pending, /Recover before the deadline[\s\S]*Billing is unchanged/);
  assert.match(
    deletion.slice(finalCleanupStart),
    /const cleanupResult = await clearLocalBrowserData\(deletionUserKey\);[\s\S]*currentAuthUserKeyRef\.current === deletionUserKey[\s\S]*onClearAll\(\);\s*setDeleteAccountOpen/,
  );
  const recovery = settings.slice(
    settings.indexOf("  const handleRecoverAccount = async () => {"),
    deletionStart,
  );
  assert.match(recovery, /deletionStatus\.state !== "scheduled"/);
  assert.match(recovery, /requestAccountDeletion\(deletionUserKey, "PATCH"\)/);
  assert.match(recovery, /if \(!currentDeletion\(\)\) return/);
  assert.doesNotMatch(recovery, /clearLocalBrowserData|onClearAll\(|signOut\(/);
  assert.match(policy, /ACCOUNT_RECOVERY_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(policy, /recovery - scheduled !== ACCOUNT_RECOVERY_MS/);
  assert.match(
    settings,
    /localCleanupIncomplete = !cleanupResult\.resolved \|\| cleanupFailureCount > 0[\s\S]{0,500}Account deletion completed, but some data in this browser could not be removed/,
  );
  assert.match(
    settings,
    /deleteSavedMemoryAfterDraining\(\{[\s\S]{0,500}authFetch\("\/api\/memory", \{ method: "DELETE" \}\)/,
  );
  assert.doesNotMatch(settings, /All conversation memory cleared/);
  assert.match(
    settings,
    /const result = await clearLocalBrowserData\(resetUserKey\);[\s\S]{0,500}currentAuthUserKeyRef\.current === resetUserKey[\s\S]{0,160}onChange\(DEFAULT_SETTINGS\);\s*onClearAll\(\);[\s\S]{0,650}toast\.success\("This profile's local browser data was reset\."\)/,
  );
  assert.match(
    settings,
    /<WorkspaceDefaults userKey=\{userKey\} principalResolved=\{isLoaded\} \/>/,
  );
  assert.match(settings, /<LocationControlsUnavailable \/>/);
  assert.doesNotMatch(settings, /LOCATION_KEY_BASE|navigator\.geolocation|getCurrentPosition/);
  assert.doesNotMatch(
    settings,
    /localStorage\.getItem\("kova-(?:workspace-defaults-v1|location)"\)/,
  );
  assert.doesNotMatch(settings, /localStorage\.setItem\("kova-(?:workspace-defaults-v1|location)"/);

  assert.match(
    home,
    /onClearAll=\{\(\) => \{[\s\S]{0,160}storageGenerationRef\.current \+= 1[\s\S]{0,700}setConversationState\(\{ principal: storagePrincipal, items: \[\] \}\);[\s\S]{0,300}setSettingsPrincipal\(storagePrincipal\)[\s\S]{0,320}setEditingMessage\(null\)/,
  );
  assert.match(images, /isPrincipalBrowserStorageClearedEvent\(event, userKey\)/);
  assert.doesNotMatch(images, /startsWith\("nova-gpt-conversations"\)/);
});
