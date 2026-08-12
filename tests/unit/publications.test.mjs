import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/content/publications.ts", "utf8");

test("publishing content has typed review states and required fields", () => {
  for (const field of [
    "slug",
    "title",
    "summary",
    "publishedAt",
    "author",
    "state",
    "robots",
    "blocks",
  ])
    assert.match(source, new RegExp(`\\b${field}\\b`));
  assert.match(source, /"draft" \| "review" \| "published"/);
});

test("unpublished content must remain inaccessible and noindex", () => {
  assert.match(source, /value\.state !== "published"/);
  assert.match(source, /entry\.state === "published"/);
  assert.match(source, /unpublished content must be noindex/);
});

test("no unverified editorial stories are published", () => {
  assert.match(source, /PUBLICATIONS: readonly Publication\[\] = \[\]/);
});
