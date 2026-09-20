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
const writeApi = readFileSync(new URL("../../src/routes/api/write.ts", import.meta.url), "utf8");

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

test("writing family bounds requests and rejects stale or unusable responses", () => {
  assert.match(workspace, /<AppShell>/);
  assert.match(workspace, /fetchWithTimeoutAuthenticated\("\/api\/write"/);
  assert.match(workspace, /MAX_FILE_BYTES = 40_000/);
  assert.match(workspace, /MAX_INPUT_CHARACTERS = 40_000/);
  assert.match(workspace, /WRITE_MAX_BODY_BYTES = 64 \* 1024/);
  assert.match(workspace, /requestRevision !== revisionRef\.current/);
  assert.match(workspace, /response\.status === 401/);
  assert.match(workspace, /!payload\.text\.trim\(\)/);
  assert.match(workspace, /Files stay in this browser until you submit text/);
  assert.match(workspace, /tabIndex=\{-1\}/);
  assert.match(workspace, /break-words whitespace-pre-wrap/);
  assert.match(indexRoute, /WRITING_TOOLS\.map/);
  assert.match(indexRoute, /tabIndex=\{-1\}/);
  assert.match(detailRoute, /throw notFound\(\)/);
  assert.doesNotMatch(detailRoute, /name: "robots"/);
});

test("writing settings reach generated rewrites while focused checkers stay narrow", () => {
  assert.match(workspace, /\.\.\.\(instruction \? \{ instructions: instruction \} : \{\}\)/);
  assert.match(workspace, /tool\.supportsSettings === false/);
  assert.match(writeApi, /const extraInstruction =/);
  assert.match(writeApi, /\[PROMPTS\[action\], extraInstruction\]/);
  assert.match(
    catalog,
    /slug: "punctuation-checker"[\s\S]{0,500}action: "custom"[\s\S]{0,500}Correct only punctuation errors/u,
  );
  assert.match(
    catalog,
    /slug: "spell-checker"[\s\S]{0,500}action: "custom"[\s\S]{0,500}Correct only spelling errors/u,
  );
});
