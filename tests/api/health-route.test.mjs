import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const route = await readFile("src/routes/api/health.ts", "utf8");
const diagnostics = await readFile("src/lib/config/diagnostics.server.ts", "utf8");

test("health route exposes only safe diagnostic booleans and missing names", () => {
  assert.match(route, /createFileRoute\("\/api\/health"\)/);
  assert.match(route, /safeDiagnostics\(\)/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /supabaseAdmin|createClient|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("diagnostics records configuration presence without secret values", () => {
  assert.match(diagnostics, /FeatureStatus/);
  assert.match(diagnostics, /missing: string\[\]/);
  assert.match(diagnostics, /OPENAI_API_KEY/);
  assert.match(diagnostics, /FIRECRAWL_API_KEY/);
  assert.match(diagnostics, /deepResearchRuns: "declared"/);
  assert.doesNotMatch(diagnostics, /process\.env\[[^\]]+\].*JSON\.stringify/);
});
