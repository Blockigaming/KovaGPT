import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventory = JSON.parse(readFileSync("docs/ui-ux/live-surface-inventory.json", "utf8"));

test("live UI inventory records the complete discoverable source snapshot", () => {
  assert.match(inventory.snapshotDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.doesNotMatch(
    readFileSync("scripts/ui-surface-inventory.mjs", "utf8"),
    /const SNAPSHOT_DATE = ["']\d{4}-\d{2}-\d{2}["']/u,
  );
  assert.equal(inventory.openai.sitemapCount, 38);
  assert.equal(inventory.openai.uniqueUrlCount, 1704);
  assert.equal(inventory.chatgpt.sitemapEntryCount, 98);
  assert.ok(inventory.chatgpt.marketingNavigation.pathCount >= 49);

  assert.equal(new Set(inventory.openai.urls).size, inventory.openai.uniqueUrlCount);
  assert.equal(new Set(inventory.chatgpt.urls).size, inventory.chatgpt.sitemapEntryCount);
  assert.ok(inventory.openai.urls.every((url) => url.startsWith("https://openai.com/")));
  assert.ok(
    inventory.chatgpt.urls.every(
      (url) => url === "https://chatgpt.com" || url.startsWith("https://chatgpt.com/"),
    ),
  );
});

test("Kova inventory separates interface templates from service handlers", () => {
  const { kovagpt } = inventory;
  assert.equal(
    kovagpt.uiRouteTemplateCount + kovagpt.serviceRouteTemplateCount,
    kovagpt.routeTemplateCount,
  );
  assert.equal(kovagpt.routeTemplateCount, 170);
  assert.equal(kovagpt.uiRouteTemplateCount, 72);
  assert.equal(kovagpt.publicContentSlugCount, 40);
  assert.equal(
    new Set(kovagpt.routeTemplates.map(({ route }) => route)).size,
    kovagpt.routeTemplateCount,
  );
  assert.match(inventory.scope.adaptationRule, /original Kova-branded equivalents/u);
});
