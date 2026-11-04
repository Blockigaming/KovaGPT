import assert from "node:assert/strict";
import test from "node:test";
import { migratedPublicPath } from "../../src/lib/public-url-migrations.mjs";
import { PUBLIC_REVIEW_PATHS, PUBLIC_SITEMAP_ENTRIES } from "../../src/lib/seo-policy.mjs";

test("public canonical registries contain only KovaGPT-owned brand paths", () => {
  for (const path of [...PUBLIC_REVIEW_PATHS, ...PUBLIC_SITEMAP_ENTRIES.map((x) => x.path)]) {
    assert.doesNotMatch(path, /chatgpt/i, path);
  }
  assert.equal(new Set(PUBLIC_REVIEW_PATHS).size, PUBLIC_REVIEW_PATHS.length);
});
test("old public bookmarks resolve directly to their canonical KovaGPT replacement", () => {
  const migrated = PUBLIC_REVIEW_PATHS.filter((path) => path.includes("kovagpt"));
  assert.equal(migrated.length, 26);
  for (const path of migrated) {
    assert.equal(migratedPublicPath(path.replaceAll("kovagpt", "chatgpt")), path);
    assert.equal(migratedPublicPath(path), null, "canonical paths must not redirect again");
  }
});
test("unknown paths and external URLs cannot enter the migration redirect", () => {
  for (const path of [
    "/api/chatgpt",
    "/chatgpt-made-up",
    "//evil.example/chatgpt",
    "https://evil.example/chatgpt",
    "/projects/private",
    "/login",
  ]) {
    assert.equal(migratedPublicPath(path), null);
  }
});
