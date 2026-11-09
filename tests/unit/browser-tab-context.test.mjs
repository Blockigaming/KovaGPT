import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeTabIdentity,
  prepareActiveTab,
  reviewedTabContext,
} from "../../browser-extension/context.mjs";
const tab = { id: 7, url: "https://example.com/private", title: "Current document" };

test("extension accepts only an explicitly identified HTTPS tab without URL credentials", () => {
  assert.deepEqual(activeTabIdentity(tab), tab);
  for (const bad of [
    null,
    { ...tab, id: -1 },
    { ...tab, url: "chrome://settings" },
    { ...tab, url: "file:///private" },
    { ...tab, url: "javascript:alert(1)" },
    { ...tab, url: "http://example.com/" },
    { ...tab, url: "https://user:password@example.com/" },
  ])
    assert.throws(() => activeTabIdentity(bad));
});
test("extension context is bounded plain text and removes title control characters", () => {
  const result = reviewedTabContext(
    { ...tab, title: "Example\nInjected\0Title" },
    "x".repeat(20000),
  );
  assert.ok(result.startsWith("Example Injected Title\nhttps://example.com/private\n"));
  assert.equal(result.split("Selected text:\n")[1].length, 16000);
  assert.throws(() => reviewedTabContext(tab, {}), /selected text/u);
});
test("title/address preparation never reads selected text without opt-in", async () => {
  let scripts = 0;
  const api = {
    tabs: { query: async () => [tab], get: async () => tab },
    scripting: {
      executeScript: async () => {
        scripts++;
        return [{ frameId: 0, result: "Selected excerpt" }];
      },
    },
  };
  assert.equal(await prepareActiveTab(api, false), "Current document\nhttps://example.com/private");
  assert.equal(scripts, 0);
  assert.match(await prepareActiveTab(api, true), /Selected excerpt/u);
  assert.equal(scripts, 1);
});
test("navigation, active-tab changes and unexpected frame results invalidate preparation", async () => {
  const api = {
    tabs: {
      query: async () => [tab],
      get: async () => ({ ...tab, url: "https://example.com/changed" }),
    },
    scripting: { executeScript: async () => [{ frameId: 0, result: "excerpt" }] },
  };
  await assert.rejects(() => prepareActiveTab(api, true), /navigated/u);
  api.tabs.get = async () => tab;
  let reads = 0;
  api.tabs.query = async () => [++reads === 1 ? tab : { ...tab, id: 9 }];
  await assert.rejects(() => prepareActiveTab(api, true), /navigated/u);
  api.tabs.query = async () => [tab];
  api.scripting.executeScript = async () => [{ frameId: 3, result: "iframe content" }];
  await assert.rejects(() => prepareActiveTab(api, true), /unavailable/u);
});
test("extension has no permanent website access, background worker or automatic network destination", () => {
  const manifest = JSON.parse(readFileSync("browser-extension/manifest.json", "utf8"));
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "clipboardWrite"]);
  for (const key of ["host_permissions", "content_scripts", "background", "externally_connectable"])
    assert.equal(manifest[key], undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/u);
});
