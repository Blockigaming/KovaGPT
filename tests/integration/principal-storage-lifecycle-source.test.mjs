import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clerkSource = readFileSync("src/components/auth/ClerkSafe.tsx", "utf8");
const settingsSource = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const storageSource = readFileSync("src/lib/principal-browser-storage.mjs", "utf8");

function sourceSection(start, end, from = 0) {
  const startIndex = clerkSource.indexOf(start, from);
  const endIndex = clerkSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source section: ${start}`);
  return clerkSource.slice(startIndex, endIndex);
}

const legacyProviderStart = clerkSource.indexOf("function SupabaseClerkProvider(");
assert.ok(legacyProviderStart >= 0);
const legacyHydration = sourceSection(
  "async function hydrateSession()",
  "\n    hydrateSession();",
  legacyProviderStart,
);

test("auth cleanup is principal-exact and covers every sign-out path", () => {
  assert.match(clerkSource, /clearPrincipalBrowserStorage/);
  assert.match(clerkSource, /browserStorageUserIdRef/);
  assert.match(
    sourceSection("const acceptSession", "\n  useEffect(() => {", legacyProviderStart),
    /if \(disposition\.kind === "terminal"\) \{[\s\S]*?const cleanupIds = \[[\s\S]*?candidate\.user\.id,[\s\S]*?clearBrowserStateFor\(\.\.\.cleanupIds\);[\s\S]*?await auth\.signOut\(\)[\s\S]*?if \(!current\(\)\) return;[\s\S]*?purgeOwnerlessStateFor\(null\)/,
  );
  assert.match(clerkSource, /if \(!candidate\) \{[\s\S]*?clearBrowserStateFor/);
  assert.match(clerkSource, /onCancel=\{\(\) => void signOut\(\)\}/);
  assert.match(
    clerkSource,
    /const browserStorageUserId = browserStorageUserIdRef\.current;[\s\S]*?clearBrowserStateFor\(browserStorageUserId, pendingValidationUserId\)/,
  );
  assert.doesNotMatch(clerkSource, /clearPrivateBrowserState/);
  assert.doesNotMatch(clerkSource, /key\.startsWith\("nova-"\)/);
  assert.doesNotMatch(clerkSource, /key\.startsWith\("kova"\)/);
  assert.doesNotMatch(clerkSource, /key\.startsWith\("sb-"\)/);
});

test("retryable, restore-error, and MFA states never resolve as guest", () => {
  const retryStart = clerkSource.indexOf("const markRetryableAuthFailure");
  const retryEnd = clerkSource.indexOf("const acceptSession", retryStart);
  const retryableFailure = clerkSource.slice(retryStart, retryEnd);
  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  assert.doesNotMatch(retryableFailure, /clearBrowserStateFor|auth\.signOut/);
  assert.match(retryableFailure, /setSession\(retainedSession\)/);
  assert.match(retryableFailure, /setIsLoaded\(Boolean\(retainedSession\)\)/);
  assert.match(
    clerkSource,
    /if \(disposition\.kind === "retryable"\) \{[\s\S]{0,180}markRetryableAuthFailure\([\s\S]{0,160}"returned"/,
  );
  assert.match(
    clerkSource,
    /classifyThrownAuthValidationError\(error\)[\s\S]{0,180}markRetryableAuthFailure\(candidate, error, "thrown"\)/,
  );
  assert.match(legacyHydration, /const disposition = classifySessionRestoreError\(error\)/);
  assert.match(
    legacyHydration,
    /if \(disposition\.kind === "terminal"\) \{[\s\S]*?await auth\.signOut\(\)[\s\S]*?if \(!current\(hydrationValidation\)\) return;[\s\S]*?purgeOwnerlessStateFor\(null\)[\s\S]*?onAuthorityResolved\?\.\(authorityRevision\);\s*\} else \{\s*markRetryableAuthFailure\(data\.session, error, "restore"\);\s*onAuthorityFailed\?\.\(authorityRevision\)/,
  );
  assert.doesNotMatch(clerkSource, /acceptSession\(null\)/);
  assert.match(clerkSource, /setPendingMfaSession\(candidate\);[\s\S]{0,260}setIsLoaded\(false\);/);
  assert.match(clerkSource, /configuration_unavailable"[\s\S]{0,180}setIsLoaded\(false\)/);
});

test("auth events invalidate hydration before stale restore success can commit", () => {
  const authEvent = sourceSection(
    "const { data: sub } = auth.onAuthStateChange",
    "async function hydrateSession()",
    legacyProviderStart,
  );
  const validationGuard = sourceSection(
    "const current = (validation: number) =>",
    "const config = getSupabaseClientConfigStatus();",
    legacyProviderStart,
  );
  assert.match(
    validationGuard,
    /isCurrentAuthValidation\(validation, sessionValidationRef\.current, cancelled\) &&\s*authorityGeneration === kovaAuthGeneration\(\) &&\s*isLegacySessionValidationAllowed\(\)/,
  );
  assert.match(authEvent, /const eventValidation = \+\+sessionValidationRef\.current/);
  assert.match(
    authEvent,
    /const eventValidation = \+\+sessionValidationRef\.current;[\s\S]*?window\.setTimeout\(\(\) => \{\s*if \(current\(eventValidation\)\) \{\s*void acceptSession\(newSession\)/,
  );
  assert.match(
    legacyHydration,
    /if \(!current\(hydrationValidation\)\) return;\s*if \(oauthSession\) \{\s*await acceptSession\(oauthSession\)/,
  );
  assert.match(
    legacyHydration,
    /if \(!current\(hydrationValidation\)\) return;\s*await acceptSession\(data\.session\)/,
  );
  assert.doesNotMatch(
    legacyHydration,
    /if \(cancelled\) return;\s*await acceptSession\(data\.session\)/,
  );
});

test("first resolution and guest-to-user transitions purge only ownerless private state", () => {
  assert.match(
    clerkSource,
    /browserStorageUserIdRef = useRef<string \| null \| undefined>\(undefined\)/,
  );
  assert.match(
    clerkSource,
    /pendingValidationUserIdRef = useRef<string \| undefined>\(undefined\)/,
  );
  assert.match(clerkSource, /const result = purgeUnscopedPrivateBrowserStorage\(userId\)/);
  assert.match(
    clerkSource,
    /if \(browserStorageUserIdRef\.current !== validatedUser\.id\) \{\s*purgeOwnerlessStateFor\(validatedUser\.id\)/,
  );
  assert.match(clerkSource, /typeof previousUserId === "string" \? previousUserId : undefined/);
  assert.match(
    clerkSource,
    /clearBrowserStateFor\(\s*typeof previousUserId === "string" \? previousUserId : undefined,\s*pendingUserId,\s*\)/,
  );
  assert.doesNotMatch(clerkSource, /pendingValidationUserIdRef\.current = null/);
  assert.doesNotMatch(clerkSource, /clearBrowserStateFor\(previousUserId\)/);
});

test("Settings uses the same current-principal registry and truthful copy", () => {
  assert.match(settingsSource, /await resetPrincipalDeviceData\(targetUserKey\)/);
  const localReset = settingsSource.slice(
    settingsSource.indexOf("const confirmLocalReset ="),
    settingsSource.indexOf("const handleCheckDeletion ="),
  );
  assert.match(localReset, /request\.ownerId !== currentAuthUserKeyRef\.current/);
  assert.match(localReset, /const resetUserKey = request\.ownerId/);
  assert.doesNotMatch(localReset, /requestAccountDeletion|signOut/);
  const accountDeletion = settingsSource.slice(
    settingsSource.indexOf("const handleDeleteAccount ="),
    settingsSource.indexOf("const handleClearSavedMemory ="),
  );
  assert.match(
    accountDeletion,
    /if \(deleteConfirmation !== "DELETE" \|\| deleteAccountBusy \|\| !isLoaded \|\| !userKey\) return/,
  );
  assert.match(accountDeletion, /const deletionUserKey = userKey/);
  assert.match(accountDeletion, /currentAuthUserKeyRef\.current === deletionUserKey/);
  assert.match(accountDeletion, /requestAccountDeletion\(deletionUserKey, "DELETE"\)/);
  const pendingDeletion = accountDeletion.slice(
    accountDeletion.indexOf("if (response.status !== 204)"),
    accountDeletion.indexOf("// Only a verified final 204"),
  );
  assert.match(pendingDeletion, /response\.status === 202 && result\?\.state === "scheduled"/);
  assert.match(pendingDeletion, /return;\s*\}/);
  assert.doesNotMatch(pendingDeletion, /clearLocalBrowserData|signOut/);
  assert.match(accountDeletion, /await clearLocalBrowserData\(deletionUserKey\)/);
  assert.match(
    accountDeletion,
    /if \(currentAuthUserKeyRef\.current === deletionUserKey\) await clerk\?\.signOut\(\)/,
  );
  assert.match(
    settingsSource,
    /Ownerless\s+private\s+data,[\s\S]*?transitional values from older versions,[\s\S]*?Other profiles' scoped data,[\s\S]*?cloud data are preserved/,
  );
  assert.match(settingsSource, /Reset this profile's local data/);
  assert.match(settingsSource, /currentAuthUserKeyRef\.current === resetUserKey/);
  assert.match(settingsSource, /failureCount > 0/);
  assert.doesNotMatch(
    settingsSource,
    /Clears cached chats, drafts, and preferences stored on this device/,
  );
});

test("the registry keeps device policy and other principals out of broad cleanup", () => {
  for (const key of [
    "nova-gpt-theme",
    "kova-theme-mode",
    "kova-sidebar-open",
    "kova-library-view",
  ]) {
    assert.match(storageSource, new RegExp(`"${key}"`));
  }
  assert.match(storageSource, /userKey === undefined/);
  assert.match(storageSource, /PRINCIPAL_SESSION_STORAGE_BASES/);
  assert.match(storageSource, /GUEST_LEGACY_LOCAL_EXACT_KEYS/);
  assert.doesNotMatch(storageSource, /startsWith\("nova-"\)/);
  assert.doesNotMatch(storageSource, /startsWith\("kova"\)/);
  assert.doesNotMatch(storageSource, /startsWith\("sb-"\)/);
});
