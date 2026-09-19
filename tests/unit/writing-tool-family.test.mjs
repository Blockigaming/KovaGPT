import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = readFileSync(
  new URL("../../src/lib/writing-tool-catalog.ts", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../src/components/writing/WritingToolWorkspace.tsx", import.meta.url),
  "utf8",
);
const indexRoute = readFileSync(
  new URL("../../src/routes/writing.index.tsx", import.meta.url),
  "utf8",
);
const detailRoute = readFileSync(
  new URL("../../src/routes/writing.$toolSlug.tsx", import.meta.url),
  "utf8",
);

const expectedSlugs = [
  "ai-detector",
  "ai-humanizer",
  "ai-text-generator",
  "apa-citation",
  "cv-generator",
  "email-writer",
  "essay-checker",
  "grammar",
  "harvard-referencing-generator",
  "mla-citation",
  "paragraph-rewriter",
  "paraphrase",
  "plagiarism-check",
  "punctuation-checker",
  "resume-building",
  "rewording-tool",
  "sentence-rewriter",
  "spell-checker",
  "story-generator",
  "summarizer",
  "word-counter",
];

test("catalog contains every observed writing tool exactly once", () => {
  for (const slug of expectedSlugs) {
    assert.equal((catalog.match(new RegExp(`slug: "${slug}"`, "g")) ?? []).length, 1, slug);
  }
  assert.equal((catalog.match(/slug: "/g) ?? []).length, expectedSlugs.length);
});

test("source-recovered format, tone, and length choices remain complete", () => {
  for (const option of [
    "Text",
    "Email",
    "Caption",
    "Article",
    "Social post",
    "Friendly",
    "Neutral",
    "Professional",
    "Natural",
    "Concise",
    "Kind",
    "Casual",
    "Brief",
    "Standard",
    "Detailed",
    "Comprehensive",
  ])
    assert.match(catalog, new RegExp(`"${option}"`));
});

test("detector and plagiarism tools state truthful capability boundaries", () => {
  assert.match(workspace, /does not invent an “AI percentage.”/);
  assert.match(workspace, /cannot truthfully report a plagiarism score/);
  assert.doesNotMatch(workspace, /Math\.random|fake score|guaranteed human/i);
});

test("writing family uses shared shell, authenticated API calls, upload limits, and unknown-route 404", () => {
  assert.match(workspace, /<AppShell>/);
  assert.match(workspace, /authFetch\("\/api\/write"/);
  assert.match(workspace, /MAX_FILE_BYTES = 1024 \* 1024/);
  assert.match(workspace, /Files stay in this browser until you submit text/);
  assert.match(indexRoute, /WRITING_TOOLS\.map/);
  assert.match(detailRoute, /throw notFound\(\)/);
});
