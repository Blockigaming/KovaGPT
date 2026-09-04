import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clerkSource = readFileSync("src/components/auth/ClerkSafe.tsx", "utf8");
const settingsSource = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const storageSource = readFileSync("src/lib/principal-browser-storage.mjs", "utf8");

test("auth cleanup is principal-exact and covers every sign-out path", () => {
  assert.match(clerkSource, /clearPrincipalBrowserStorage/);
  assert.match(clerkSource, /browserStorageUserIdRef/);
  assert.match(
    clerkSource,
    /if \(disposition\.kind === "terminal"\) \{[\s\S]*?const cleanupIds = \[[\s\S]*?candidate\.user\.id,[\s\S]*?clearBrowserStateFor\(\.\.\.cleanupIds\);[\s\S]*?supabase\.auth\.signOut/,
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
  assert.match(clerkSource, /const disposition = classifySessionRestoreError\(error\)/);
  assert.match(
    clerkSource,
    /if \(disposition\.kind === "terminal"\) \{[\s\S]{0,1200}purgeOwnerlessStateFor\(null\)[\s\S]{0,300}else \{\s*markRetryableAuthFailure\(data\.session, error, "restore"\)/,
  );
  assert.doesNotMatch(clerkSource, /acceptSession\(null\)/);
  assert.match(clerkSource, /setPendingMfaSession\(candidate\);[\s\S]{0,260}setIsLoaded\(false\);/);
  assert.match(clerkSource, /configuration_unavailable"[\s\S]{0,180}setIsLoaded\(false\)/);
});

test("auth events invalidate hydration before stale restore success can commit", () => {
  const authEventStart = clerkSource.indexOf("supabase.auth.onAuthStateChange");
  const hydrateStart = clerkSource.indexOf("async function hydrateSession()", authEventStart);
  const hydrateEnd = clerkSource.indexOf("hydrateSession();", hydrateStart);
  const authEvent = clerkSource.slice(authEventStart, hydrateStart);
  const hydrate = clerkSource.slice(hydrateStart, hydrateEnd);

  assert.ok(authEventStart >= 0 && hydrateStart > authEventStart && hydrateEnd > hydrateStart);
  assert.match(authEvent, /const eventValidation = \+\+sessionValidationRef\.current/);
  assert.match(
    authEvent,
    /isCurrentAuthValidation\(eventValidation, sessionValidationRef\.current, cancelled\)[\s\S]{0,100}acceptSession\(newSession\)/,
  );
  assert.match(
    hydrate,
    /!isCurrentAuthValidation\([\s\S]{0,160}hydrationValidation,[\s\S]{0,120}sessionValidationRef\.current,[\s\S]{0,80}cancelled[\s\S]{0,100}await acceptSession\(oauthSession\)/,
  );
  assert.match(
    hydrate,
    /!isCurrentAuthValidation\([\s\S]{0,160}hydrationValidation,[\s\S]{0,120}sessionValidationRef\.current,[\s\S]{0,80}cancelled[\s\S]{0,100}await acceptSession\(data\.session\)/,
  );
  assert.doesNotMatch(hydrate, /if \(cancelled\) return;\s*await acceptSession\(data\.session\)/);
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
  assert.match(settingsSource, /clearPrincipalBrowserStorage\(targetUserKey\)/);
  assert.match(
    settingsSource,
    /const cleanupResult = clearLocalBrowserData\(deletionUserKey\);[\s\S]*?currentAuthUserKeyRef\.current === deletionUserKey[\s\S]*?onClearAll\(\)/,
  );
  assert.match(
    settingsSource,
    /Ownerless private data,[\s\S]*?transitional values from older versions,[\s\S]*?Other profiles' scoped data,[\s\S]*?cloud data are preserved/,
  );
  assert.match(settingsSource, /Reset this profile's local data/);
  assert.match(settingsSource, /dispatchPrincipalBrowserStorageCleared\(userKey\)/);
  assert.match(settingsSource, /cleanupFailureCount > 0/);
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
