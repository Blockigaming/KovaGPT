import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("deep research module defines a multi-stage workflow", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  for (const token of [
    "ResearchStage",
    "ResearchEvidence",
    "ResearchResult",
    "makePlan",
    "searchWeb",
    "buildEvidence",
    "writeReport",
    "runDeepResearch",
    "partialFailures",
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`), `deep research should include ${token}`);
  }
});

test("deep research reports are instructed to use evidence citations only", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  assert.match(source, /provided evidence only/);
  assert.match(source, /Markdown links whose labels name the source/);
  assert.match(source, /URLs exactly match the evidence/);
  assert.match(source, /Do not invent citations, sources, or URLs/);
});

test("chat route has a separate deep research execution path", () => {
  const chat = read("src/routes/api/chat.ts");
  assert.match(chat, /@\/lib\/ai\/deep-research\.server/);
  assert.match(chat, /clientTool === "deep_research"/);
  assert.match(chat, /kind: "research_progress"/);
});
