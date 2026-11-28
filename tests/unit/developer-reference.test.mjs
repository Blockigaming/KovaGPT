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
