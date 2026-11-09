import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isKovaUrl,
  isOpenAppLink,
  externalUrl,
  WEB_PREFERENCES,
  COMPANION_SHORTCUTS,
  defaultCompanionShortcut,
  validatedCompanionShortcut,
} from "../policy.mjs";
test("only the exact HTTPS Kova origin may navigate inside the window", () => {
  for (const url of [
    "https://kovagpt.com/",
    "https://kovagpt.com/projects/abc",
    "https://kovagpt.com/~oauth/callback?code=x",
  ])
    assert.equal(isKovaUrl(url), true);
  for (const url of [
    "https://kovagpt.com.evil.test/",
    "https://evil.test/kovagpt.com",
    "http://kovagpt.com/",
    "https://kovagpt.com:444/",
    "https://user@kovagpt.com/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,x",
  ])
    assert.equal(isKovaUrl(url), false, url);
});
test("the app protocol only focuses the app; arbitrary destinations and auth tokens are rejected", () => {
  for (const url of ["kovagpt://open", "kovagpt://open/"]) assert.equal(isOpenAppLink(url), true);
  for (const url of [
    "kovagpt://open?url=https://evil.test",
    "kovagpt://open?token=x",
    "kovagpt://open/#x",
    "kovagpt://open/path",
    "kovagpt://other",
    "kovagpt://user@open",
    "file:///open",
    "https://open",
    "garbage",
  ])
    assert.equal(isOpenAppLink(url), false, url);
});
test("external links reject local files, commands, credentials and unsupported schemes", () => {
  assert.equal(externalUrl("https://example.com/source"), "https://example.com/source");
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,x",
    "http://example.com",
    "https://user:secret@example.com/",
    "ms-settings:",
    "kovagpt://open",
  ])
    assert.equal(externalUrl(url), null);
});
test("remote web content has no desktop privileges", () => {
  assert.equal(WEB_PREFERENCES.sandbox, true);
  assert.equal(WEB_PREFERENCES.contextIsolation, true);
  assert.equal(WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(WEB_PREFERENCES.nodeIntegrationInWorker, false);
  assert.equal(WEB_PREFERENCES.nodeIntegrationInSubFrames, false);
  assert.equal(WEB_PREFERENCES.webviewTag, false);
  assert.equal(WEB_PREFERENCES.webSecurity, true);
  assert.equal(WEB_PREFERENCES.allowRunningInsecureContent, false);
  assert.equal(WEB_PREFERENCES.navigateOnDragDrop, false);
});

test("desktop companion accelerators are limited to reviewed choices", () => {
  assert.deepEqual(COMPANION_SHORTCUTS, [
    "Alt+Space",
    "CommandOrControl+Shift+Space",
    "CommandOrControl+Shift+K",
    "Disabled",
  ]);
  assert.equal(defaultCompanionShortcut("darwin"), "Alt+Space");
  assert.equal(defaultCompanionShortcut("win32"), "Alt+Space");
  assert.equal(defaultCompanionShortcut("linux"), "CommandOrControl+Shift+Space");
  for (const value of ["Control+Alt+Delete", "javascript:alert(1)", "", null])
    assert.equal(validatedCompanionShortcut(value, "darwin"), "Alt+Space");
  assert.equal(validatedCompanionShortcut("Disabled", "win32"), "Disabled");
});

test("desktop companion window retains the hardened renderer and OS controls", () => {
  const source = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
  assert.ok(source.includes("alwaysOnTop: companion"));
  assert.ok(source.includes("webPreferences: { ...WEB_PREFERENCES }"));
  assert.ok(source.includes("globalShortcut.register(shortcut, openCompanion)"));
  assert.ok(source.includes('label: "Launch at login"'));
  assert.ok(source.includes("globalShortcut.unregisterAll()"));
});
