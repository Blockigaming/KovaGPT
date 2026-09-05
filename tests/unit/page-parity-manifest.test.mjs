import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(path, "utf8");
const inventory = JSON.parse(read("docs/page-parity/source-inventory.json"));
const routes = JSON.parse(read("docs/release-reconciliation/canonical-route-manifest.json"));

test("provided snapshot imports all 132 exact unique URLs without claiming a live crawl", () => {
  const snapshot = JSON.parse(read("docs/page-parity/provided-source-snapshot.json"));
  assert.equal(snapshot.openaiSitemapSections.length, 35);
  assert.equal(new Set(snapshot.openaiSitemapSections).size, 35);
  assert.equal(snapshot.chatgptPrimaryUrls.length, 97);
  assert.equal(new Set(snapshot.chatgptPrimaryUrls).size, 97);
  assert.equal(inventory.entries.length, 132);
  assert.equal(new Set(inventory.entries.map((entry) => entry.sourceUrl)).size, 132);
  assert.deepEqual(
    new Set(inventory.entries.map((entry) => entry.sourceUrl)),
    new Set([...snapshot.openaiSitemapSections, ...snapshot.chatgptPrimaryUrls]),
  );
  const required = [
    "id",
    "sourceUrl",
    "sourceDomain",
    "snapshotDate",
    "evidenceQuality",
    "needsLiveRevalidation",
    "sourceSitemapFamily",
    "sourcePageType",
    "sourceLocale",
    "isUserGenerated",
    "isDynamic",
    "authenticationClassification",
    "kovaDisposition",
    "kovaCanonicalRoute",
    "kovaTemplateFamily",
    "kovaRouteFile",
    "contentRegistryKey",
    "indexingState",
    "legalReviewState",
    "administratorContentState",
    "runtimeResult",
    "metadataResult",
    "testReference",
    "reason",
  ];
  for (const [index, entry] of inventory.entries.entries()) {
    for (const key of required)
      assert.ok(Object.hasOwn(entry, key), `entry ${index} missing ${key}`);
    assert.match(entry.sourceUrl, /^https:\/\/(?:openai\.com|chatgpt\.com)(?:\/|$)/);
    assert.equal(entry.snapshotDate, "2026-08-11");
    assert.equal(entry.evidenceQuality, "provided_inventory_snapshot");
    assert.equal(entry.needsLiveRevalidation, true);
    assert.notEqual(entry.runtimeResult, "verified_live_source");
  }
});

test("all inventory dispositions are allowed and mapped routes are canonical", () => {
  const allowed = new Set([
    "implemented_existing",
    "implemented_new",
    "dynamic_template",
    "localized_variant",
    "redirected",
    "intentionally_excluded",
    "blocked_external_dependency",
    "requires_admin_content",
    "requires_legal_review",
  ]);
  for (const entry of inventory.entries) {
    assert.ok(allowed.has(entry.kovaDisposition), entry.kovaDisposition);
    if (entry.kovaCanonicalRoute !== null) assert.match(entry.kovaCanonicalRoute, /^\/(?!\/)/);
  }
});

test("route manifest includes reusable public, publishing, developer, assistant and locale templates", () => {
  for (const pattern of [
    "/$slug",
    "/$section/$articleSlug",
    "/developers/$docSlug",
    "/assistants/$assistantSlug",
    "/$locale/home",
  ])
    assert.ok(
      routes.records.some(({ canonicalPath }) => canonicalPath === pattern),
      pattern,
    );
  assert.equal(routes.reviewedPublicRouteCount, 87);
});

test("Local discovery is noindex, requests no device location, and preserves an accessible main", () => {
  const maps = read("src/routes/maps.tsx");
  assert.match(maps, /name: "robots", content: "noindex"/);
  assert.match(maps, /No location permission has been requested/);
  assert.match(maps, /id="main-content"/);
  assert.doesNotMatch(maps, /getCurrentPosition|watchPosition|mapbox|google\.maps/i);
});

test("public page system contains original truthfulness and review gates", () => {
  const content = read("src/lib/public-content.ts");
  const shell = read("src/components/public/PublicSite.tsx");
  const root = read("src/routes/__root.tsx");
  assert.match(content, /KovaGPT is not OpenAI/);
  assert.match(content, /review\?: "legal" \| "admin"/);
  assert.match(shell, /legal review required/i);
  assert.match(root, /Skip to content/);
  assert.match(root, /segment === "ar" \? "rtl" : "ltr"/u);
  assert.match(shell, /min-h-11/);
});

test("public catch-all rejects every reserved application and security namespace", async () => {
  const { isReservedPublicPath } = await import("../../src/lib/public-route-policy.mjs");
  const reserved = [
    "/chat",
    "/new",
    "/search",
    "/images",
    "/library",
    "/projects",
    "/settings",
    "/pricing",
    "/api/chat",
    "/oauth/callback",
    "/auth/login",
    "/login",
    "/signup",
    "/billing/portal",
    "/admin/users",
    "/share/private",
    "/canvas/doc",
    "/maps",
    "/apps",
    "/assistants",
    "/developers",
    "/checkout/return",
  ];
  for (const path of reserved) assert.equal(isReservedPublicPath(path), true, path);
  for (const path of ["/features", "/about", "/trust", "/news"])
    assert.equal(isReservedPublicPath(path), false, path);
  const catchAll = read("src/routes/$slug.tsx");
  assert.match(catchAll, /isReservedPublicPath\(`\/\$\{params\.slug\}`\)/);
});

test("all 87 reconciled public routes are reviewed and the sitemap retains only 23 substantive routes", async () => {
  const review = JSON.parse(read("docs/page-parity/indexable-content-review.json"));
  const developer = JSON.parse(read("docs/release-reconciliation/developer-contract-report.json"));
  assert.equal(review.reviewedRouteCount, 87);
  assert.equal(new Set(review.records.map((entry) => entry.route)).size, 87);
  for (const entry of review.records) {
    assert.ok(entry.h1, entry.route);
    assert.equal(entry.runtimeStatus, 200, entry.route);
    assert.equal(entry.mobileResult, "baseline_pass_2026-08-11", entry.route);
    assert.equal(entry.darkModeResult, "baseline_pass_2026-08-11", entry.route);
    assert.equal(entry.keyboardResult, "skip_link_present", entry.route);
    assert.ok(entry.uniqueTitle, entry.route);
    assert.ok(entry.uniqueDescription, entry.route);
    assert.match(entry.canonical, /^https:\/\/kovagpt\.com\//u, entry.route);
  }
  assert.equal(developer.topicCount, 19);
  assert.equal(developer.verifiedTopics, 0);
  assert.equal(developer.noindexTopics, 19);
  assert.ok(
    developer.records.every((entry) => entry.indexingState === "noindex_until_public_contract"),
  );
  const { PUBLIC_REVIEW_PATHS, PUBLIC_SITEMAP_ENTRIES } =
    await import("../../src/lib/seo-policy.mjs");
  assert.equal(PUBLIC_REVIEW_PATHS.length, 87);
  assert.equal(PUBLIC_SITEMAP_ENTRIES.length, 23);
  const indexed = new Set(PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path));
  for (const { route } of developer.records) assert.equal(indexed.has(route), false, route);
});

test("release route manifest is generated from all route files and one sitemap source", () => {
  const manifest = JSON.parse(read("docs/release-reconciliation/canonical-route-manifest.json"));
  assert.equal(manifest.routeFileCount, 103);
  assert.equal(manifest.records.length, 103);
  assert.equal(manifest.sitemapCount, 23);
  assert.equal(manifest.reviewedPublicRouteCount, 87);
  assert.equal(new Set(manifest.records.map(({ routeFile }) => routeFile)).size, 103);
  assert.ok(
    manifest.records
      .filter(({ classification }) => classification.startsWith("reserved_"))
      .every(({ sitemapIncluded }) => sitemapIncluded === false),
  );
  assert.match(read("src/routes/$slug.tsx"), /name: "robots", content: "noindex, follow"/u);
  assert.match(read("src/routes/developers.$docSlug.tsx"), /throw notFound\(\)/u);
});
