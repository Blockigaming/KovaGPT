import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEVELOPER_ENDPOINTS,
  DEVELOPER_REFERENCE,
  DEVELOPER_REFERENCE_BY_SLUG,
  developerReferencePage,
} from "../../src/lib/developer-reference.mjs";
import { filterDeveloperReference } from "../../src/lib/developer-reference-search.mjs";
import { PUBLIC_WEBSITE_PAGES } from "../../src/lib/public-website-catalog.mjs";
import { robotsDirectiveForRoute } from "../../src/lib/seo-policy.mjs";

const root = new URL("../../src/routes/api/v1/", import.meta.url);

test("every versioned API route and HTTP handler has a public reference", async () => {
  const actual = new Map();
  async function visit(dir, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) {
        await visit(new URL(`${item.name}/`, dir), `${prefix}${item.name}/`);
      } else if (item.name.endsWith(".ts")) {
        const source = await readFile(new URL(item.name, dir), "utf8");
        const path = `/api/v1/${prefix}${item.name.slice(0, -3)}`;
        const methods = [...source.matchAll(/\b(GET|POST|DELETE|PUT|PATCH|HEAD):/g)].map(
          (match) => match[1],
        );
        actual.set(path, methods.sort());
      }
    }
  }
  await visit(root);
  assert.equal(DEVELOPER_ENDPOINTS.length, actual.size);
  for (const entry of DEVELOPER_ENDPOINTS) {
    assert.deepEqual([...entry.methods].sort(), actual.get(entry.path), entry.path);
    actual.delete(entry.path);
  }
  assert.equal(actual.size, 0);
});

test("all existing public developer pages remain addressable and every reference has distinct substantive content", async () => {
  const special = new Set(["docs", "api-reference", "pricing"]);
  const legacy = await readFile(
    new URL("../../src/lib/developer-docs.ts", import.meta.url),
    "utf8",
  );
  const previous = [
    ...[...legacy.matchAll(/\[\s*"([a-z0-9-]+)",/g)].map((match) => match[1]),
    ...PUBLIC_WEBSITE_PAGES.filter((page) => page.path.startsWith("/developers/")).map((page) =>
      page.path.split("/").at(-1),
    ),
  ];
  for (const slug of previous)
    assert.ok(special.has(slug) || DEVELOPER_REFERENCE_BY_SLUG.has(slug), slug);
  assert.equal(DEVELOPER_REFERENCE.length, DEVELOPER_REFERENCE_BY_SLUG.size);
  const bodies = new Set();
  for (const entry of DEVELOPER_REFERENCE) {
    const page = developerReferencePage(entry);
    assert.equal(page.indexable, false);
    assert.equal(robotsDirectiveForRoute(page.path), "noindex, follow", page.path);
    assert.ok(page.sections.length >= 2);
    assert.ok(entry.request.length > 85 && entry.behavior.length > 85, entry.slug);
    assert.ok(!bodies.has(entry.request + entry.behavior), entry.slug);
    bodies.add(entry.request + entry.behavior);
    assert.ok(page.related.some((link) => link.to === "/developers/docs"));
  }
  assert.equal(robotsDirectiveForRoute("/developers/docs"), "noindex, follow");
  assert.equal(robotsDirectiveForRoute("/developers/unknown-doc"), "noindex, nofollow");
});

test("documentation search finds methods, paths and actual request fields without fuzzy false results", () => {
  const search = (query) =>
    filterDeveloperReference(DEVELOPER_REFERENCE, query).map((entry) => entry.slug);
  assert.equal(search("  ").length, DEVELOPER_REFERENCE.length);
  assert.ok(search("POST expected_generation").includes("webhooks"));
  assert.ok(search("audio/transcriptions WAV").includes("audio-transcription"));
  assert.ok(search("chat/completions max_completion_tokens").includes("chat-completions"));
  assert.ok(search("file_ids Unicode").includes("file-search"));
  assert.deepEqual(search("not-a-real-contract-132"), []);
});

test("error and rate guides expose recovery examples and enforceable windows", () => {
  const errors = developerReferencePage(DEVELOPER_REFERENCE_BY_SLUG.get("errors"));
  const limits = developerReferencePage(DEVELOPER_REFERENCE_BY_SLUG.get("rate-limits"));
  assert.ok(
    errors.sections.some((section) =>
      section.points.some((point) => point.includes("/api/v1/usage?id=")),
    ),
  );
  assert.ok(
    limits.sections.some((section) =>
      section.points.some((point) => point.includes("Uploads: 60 per key")),
    ),
  );
  assert.ok(limits.sections.some((section) => section.body.includes("retry_after")));
});

test("frozen baseline and expanded page inventory resolve without duplicate or broken related routes", async () => {
  const { DEVELOPER_BASELINE_PATHS, DEVELOPER_DEDICATED_PATHS, DEVELOPER_PAGE_PATHS } =
    await import("../../src/lib/developer-reference.mjs");
  assert.equal(DEVELOPER_BASELINE_PATHS.length, 29);
  assert.equal(new Set(DEVELOPER_BASELINE_PATHS).size, 29);
  assert.equal(new Set(DEVELOPER_PAGE_PATHS).size, DEVELOPER_PAGE_PATHS.length);
  assert.equal(
    DEVELOPER_PAGE_PATHS.length,
    DEVELOPER_REFERENCE.length + DEVELOPER_DEDICATED_PATHS.length,
  );
  for (const path of DEVELOPER_BASELINE_PATHS) assert.ok(DEVELOPER_PAGE_PATHS.includes(path), path);
  const routes = await readdir(new URL("../../src/routes/", import.meta.url));
  for (const path of DEVELOPER_DEDICATED_PATHS) {
    const slug = path.split("/")[2];
    const file = ["docs", "api-reference"].includes(slug)
      ? "developers.$docSlug.tsx"
      : `developers.${slug || "index"}.tsx`;
    assert.ok(routes.includes(file), path);
  }
  assert.ok(routes.includes("contact-support.tsx"));
  for (const entry of DEVELOPER_REFERENCE) {
    const page = developerReferencePage(entry);
    assert.ok(DEVELOPER_PAGE_PATHS.includes(page.path));
    for (const link of page.related)
      assert.ok(link.to === "/contact-support" || DEVELOPER_PAGE_PATHS.includes(link.to), link.to);
  }
  const directory = await readFile(
    new URL("../../src/routes/developers.$docSlug.tsx", import.meta.url),
    "utf8",
  );
  const article = await readFile(
    new URL("../../src/components/public/PublicWebsiteArticle.tsx", import.meta.url),
    "utf8",
  );
  assert.match(directory, /aria-label="Breadcrumb"/);
  assert.match(directory, /aria-controls="developer-search-results"/);
  assert.match(directory, /id="developer-search-results"/);
  assert.match(directory, /role="status"/);
  assert.match(article, /aria-current="page"/);
  assert.match(article, /docSlug: "docs"/);
});

test("full-content search includes incident FAQs, detailed limits, and changelog source history", async () => {
  const search = (query) =>
    filterDeveloperReference(DEVELOPER_REFERENCE, query).map((entry) => entry.slug);
  assert.ok(search("credential leak").includes("support"));
  assert.ok(search("32 per instance").includes("rate-limits"));
  assert.ok(search("offset replay").includes("changelog"));
  const support = developerReferencePage(DEVELOPER_REFERENCE_BY_SLUG.get("support"));
  assert.ok(support.sections.some((section) => section.body.includes("support@kovagpt.com")));
  assert.ok(
    support.sections.some((section) =>
      section.points.some((point) => point.includes("Remove API keys, quote tokens")),
    ),
  );
  const changelog = developerReferencePage(DEVELOPER_REFERENCE_BY_SLUG.get("changelog"));
  const { DEVELOPER_SOURCE_HISTORY } = await import("../../src/lib/developer-reference.mjs");
  assert.equal(changelog.sources.length, DEVELOPER_SOURCE_HISTORY.length);
  assert.equal(new Set(changelog.sources.map((item) => item.href)).size, changelog.sources.length);
  for (const item of changelog.sources)
    assert.match(
      item.href,
      /^https:\/\/github\.com\/Blockigaming\/KovaGPT\/commit\/[0-9a-f]{8,40}$/,
    );
  assert.ok(changelog.sections.some((section) => section.body.includes("not release dates")));
});
