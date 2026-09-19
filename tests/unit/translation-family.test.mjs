import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = readFileSync(
  new URL("../../src/lib/translation-catalog.ts", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../src/components/translation/TranslationWorkspace.tsx", import.meta.url),
  "utf8",
);
const pairRoute = readFileSync(
  new URL("../../src/routes/translate.$pairSlug.tsx", import.meta.url),
  "utf8",
);

const pairSlugs = [
  "english-to-french",
  "english-to-hindi",
  "english-to-marathi",
  "english-to-portuguese",
  "english-to-tagalog",
  "english-to-tamil",
  "english-to-urdu",
  "hindi-to-english",
  "spanish-to-english",
  "tagalog-to-english",
];

test("catalog contains every registered translation pair exactly once", () => {
  for (const slug of pairSlugs) {
    assert.equal((catalog.match(new RegExp(`slug: "${slug}"`, "g")) ?? []).length, 1, slug);
  }
  assert.equal((catalog.match(/slug: "/g) ?? []).length, pairSlugs.length);
});

test("observed translation controls and full language choices remain implemented", () => {
  for (const language of [
    "Albanian",
    "English",
    "French",
    "Hindi",
    "Marathi",
    "Spanish",
    "Tagalog",
    "Tamil",
    "Urdu",
    "Zulu",
  ]) {
    assert.match(catalog, new RegExp(`"${language}"`));
  }
  for (const label of [
    "Swap source and target languages",
    "Add files and more",
    "Copy translation",
    "Make it sound more fluent",
    "Make it professional",
    "Explain it like I’m five",
  ]) {
    assert.match(workspace, new RegExp(label));
  }
});

test("translation calls the guarded writing API and preserves input on errors", () => {
  assert.match(workspace, /authFetch\("\/api\/write"/);
  assert.match(workspace, /action: "custom"/);
  assert.match(workspace, /Your text is still here/);
  assert.doesNotMatch(workspace, /fake|Math\.random/i);
});

test("unknown pair routes fail through the application not-found boundary", () => {
  assert.match(pairRoute, /throw notFound\(\)/);
});
