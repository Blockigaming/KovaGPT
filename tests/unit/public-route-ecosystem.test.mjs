import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const content = readFileSync("src/content/public-pages.ts", "utf8");
const routes = readdirSync("src/routes").filter((name) => name.endsWith(".tsx"));
const paths = [...content.matchAll(/\["(\/[^"$]+)"\s*,/g)].map((match) => match[1]);

test("structured public content uses unique static paths", () => {
  assert.equal(new Set(paths).size, paths.length);
});

test("mandatory dynamic and privacy-boundary routes exist", () => {
  for (const file of [
    "apps.$category.tsx",
    "assistants.$assistantSlug.tsx",
    "share.$shareId.tsx",
    "canvas.$documentId.tsx",
  ])
    assert.ok(routes.includes(file), `missing ${file}`);
});

test("public templates provide metadata and do not render unsafe HTML", () => {
  const template = readFileSync("src/components/PublicPageTemplate.tsx", "utf8");
  const head = readFileSync("src/lib/public-page-head.ts", "utf8");
  assert.doesNotMatch(template, /dangerouslySetInnerHTML/);
  assert.match(head, /seoLandingHead/);
  assert.match(content, /description:/);
});

test("only reviewed English localization is exposed", () => {
  const config = readFileSync("src/i18n/config.ts", "utf8");
  assert.match(config, /SUPPORTED_LOCALES = \["en"\]/);
  assert.match(config, /LOCALE_DIRECTIONS/);
});
