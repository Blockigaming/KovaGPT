import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = JSON.parse(readFileSync("docs/page-parity/source-inventory.json", "utf8"));
const dispositions = JSON.parse(readFileSync("docs/page-parity/reconciliation-data.json", "utf8"));
const manifest = JSON.parse(readFileSync("docs/page-parity/kova-route-manifest.json", "utf8"));

test("every source inventory record has exactly one disposition", () => {
  assert.equal(source.rows.length, 132);
  assert.equal(dispositions.length, source.rows.length);
  assert.equal(new Set(source.rows.map((row) => row.sourceId)).size, source.rows.length);
  assert.equal(new Set(dispositions.map((row) => row.sourceId)).size, dispositions.length);
  for (const row of source.rows) {
    assert.equal(dispositions.filter((item) => item.sourceId === row.sourceId).length, 1);
  }
});

test("provided snapshot contains every exact source URL without placeholders", () => {
  assert.deepEqual(source.counts, {
    openaiSitemapSections: 35,
    chatgptPrimaryUrls: 97,
    total: 132,
  });
  assert.equal(source.evidenceQuality, "provided_inventory_snapshot");
  assert.equal(source.needsLiveRevalidation, true);
  for (const row of source.rows) {
    assert.match(row.sourceUrl, /^https:\/\/(?:openai\.com|chatgpt\.com)/);
    assert.equal(row.evidenceQuality, "provided_inventory_snapshot");
    assert.notEqual(row.sourceId, null);
  }
  assert.equal(
    dispositions.some((row) => row.kovaDisposition === "source_unavailable"),
    false,
  );
});

test("every route manifest row references a real route file", () => {
  assert.equal(manifest.routes.length, manifest.counts.addedRouteFiles);
  for (const route of manifest.routes) assert.ok(existsSync(route.routeFile), route.routeFile);
});

test("sitemap contains no private, dynamic, redirected, or unreviewed route", () => {
  const sitemap = new Set(manifest.sitemapPaths);
  for (const route of manifest.routes) {
    if (route.kind === "dynamic_template" || route.authentication === "redirect_to_workspace") {
      assert.equal(sitemap.has(route.route), false, route.route);
    }
    if (route.legalReview || route.administratorContent)
      assert.equal(sitemap.has(route.route), false);
  }
  assert.equal(sitemap.has("/share/$shareId"), false);
  assert.equal(sitemap.has("/canvas/$documentId"), false);
});

test("only the reviewed locale can appear in route or sitemap manifests", () => {
  const localeConfig = readFileSync("src/i18n/config.ts", "utf8");
  assert.match(localeConfig, /SUPPORTED_LOCALES = \["en"\]/);
  assert.equal(
    manifest.routes.filter((route) => /^\/[a-z]{2}(?:\/|$)/.test(route.route)).length,
    1,
  );
  assert.equal(
    manifest.sitemapPaths.some((route) => /^\/[a-z]{2}(?:\/|$)/.test(route)),
    false,
  );
});

test("legal-review pages retain both registry state and a visible template notice", () => {
  const registry = readFileSync("src/content/public-pages.ts", "utf8");
  const template = readFileSync("src/components/PublicPageTemplate.tsx", "utf8");
  assert.equal(manifest.counts.legalReviewRoutes, 8);
  assert.match(registry, /"legal"/);
  assert.match(template, /requires professional legal review/);
});

test("developer pages do not claim unregistered API endpoints", () => {
  const registry = readFileSync("src/content/public-pages.ts", "utf8");
  assert.doesNotMatch(registry, /\b(?:GET|POST|PUT|PATCH|DELETE) \/v\d\//);
});

test("thin generated pages remain noindex rather than becoming doorway pages", () => {
  const generated = manifest.routes.filter((route) => route.routeFile.includes("src/routes/"));
  assert.ok(generated.length > 0);
  assert.ok(generated.every((route) => route.indexing === "noindex"));
});
