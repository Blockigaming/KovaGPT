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
  assert.match(workspace, /fetchWithTimeoutAuthenticated\(\s*"\/api\/write"/);
  assert.match(workspace, /action: "custom"/);
  assert.match(workspace, /Your text is still here/);
  assert.match(workspace, /MAX_FILE_BYTES = 40_000/);
  assert.match(workspace, /MAX_INPUT_CHARACTERS = 40_000/);
  assert.match(workspace, /WRITE_MAX_BODY_BYTES = 64 \* 1024/);
  assert.match(workspace, /WRITE_REQUEST_TIMEOUT_MS = 130_000/);
  assert.match(workspace, /WRITE_REQUEST_TIMEOUT_MS,\s*\)/);
  assert.match(workspace, /requestRevision !== revisionRef\.current/);
  assert.match(workspace, /response\.status === 401/);
  assert.match(workspace, /response\.status === 403/);
  assert.match(workspace, /response\.status === 429/);
  assert.match(workspace, /payload\.error\.slice\(0, 240\)/);
  assert.match(workspace, /!payload\.text\.trim\(\)/);
  assert.match(workspace, /tabIndex=\{-1\}/);
  assert.match(workspace, /role="status" aria-live="polite"/);
  assert.match(workspace, /txt\|md\|markdown\|csv\|json/);
  assert.equal((workspace.match(/dir="auto"/g) ?? []).length, 2);
  assert.doesNotMatch(workspace, /fake|Math\.random/i);
});

test("unknown pair routes fail through the application not-found boundary", () => {
  assert.match(pairRoute, /throw notFound\(\)/);
  assert.match(pairRoute, /rel: "canonical"/);
  assert.match(pairRoute, /https:\/\/kovagpt\.com\/translate\/\$\{loaderData\.pair\.slug\}/);
  assert.doesNotMatch(pairRoute, /name: "robots"/);
});
