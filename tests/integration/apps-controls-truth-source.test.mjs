import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apps = await readFile(new URL("../../src/routes/apps.tsx", import.meta.url), "utf8");

test("Apps validates principal-scoped recent activity before rendering it", () => {
  assert.match(apps, /const parsed: unknown = JSON\.parse\(raw\)/);
  assert.match(apps, /if \(!Array\.isArray\(parsed\)\) return \[\]/);
  assert.match(apps, /typeof entry\.app !== "string"/);
  assert.match(apps, /typeof entry\.action !== "string"/);
  assert.match(apps, /Number\.isFinite\(Date\.parse\(entry\.at\)\)/);
  assert.match(apps, /activity\.length >= MAX_APP_ACTIVITY/);
  assert.doesNotMatch(apps, /setActivity\(JSON\.parse/);
  assert.match(apps, /storedActivity = parseAppActivity\(storage\.getItem\(activityKey\)\)/);
  assert.match(apps, /catch \{\s+setActivityPersistenceError\(true\)/);
  assert.match(apps, /<GitHubManager key=\{principal \?\? "unresolved"\}/);
});

test("Recent activity exposes browser persistence failures without losing session state", () => {
  assert.match(apps, /activityRef\.current = next;\s+setActivity\(next\);/);
  assert.match(apps, /if \(!storage\) throw new Error\("browser_storage_unavailable"\)/);
  assert.match(apps, /setActivityPersistenceError\(true\)/);
  assert.match(apps, /Recent connection activity could not be saved in this browser/);
  assert.match(apps, /leave or reload this page/);
});

test("GitHub actions are busy-gated and report request failures", () => {
  assert.match(apps, /const busy = busyAction !== null/);
  assert.match(apps, /GitHub authorization could not be started\. Try again\./);
  assert.match(apps, /GitHub installations could not be refreshed\. Try again\./);
  assert.match(apps, /The disconnect outcome could not be confirmed/);
  assert.match(apps, /const statusLoaded = await reload\(false\)/);
  assert.match(apps, /disabled=\{busy\}/);
  assert.match(apps, /aria-busy=\{busy\}/);
  assert.doesNotMatch(apps, /refresh\(\)\.then\(reload\)/);
  assert.doesNotMatch(apps, /disconnect\([^)]*\)\.then\(reload\)/);
});

test("GitHub OAuth navigation accepts only the provider authorization endpoint", () => {
  assert.match(apps, /url\.protocol !== "https:"/);
  assert.match(apps, /url\.hostname !== "github\.com"/);
  assert.match(apps, /url\.pathname !== "\/login\/oauth\/authorize"/);
  assert.match(apps, /location\.assign\(authorizationUrl\)/);
  assert.doesNotMatch(apps, /location\.assign\(result\.url\)/);
});

test("Connector management keeps destructive state until the server confirms success", () => {
  assert.match(
    apps,
    /await disconnect\(\{ data: \{ accountId, removeData \} \}\);\s+setDisconnectOpen\(false\)/,
  );
  assert.match(apps, /if \(!busy\) setDisconnectOpen\(nextOpen\)/);
  assert.ok((apps.match(/className="min-h-11"/g) ?? []).length >= 3);
  assert.match(apps, /className="flex min-h-11 min-w-11 items-center justify-center"/);
});
