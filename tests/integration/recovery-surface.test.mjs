import { access, readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const requiredFiles = [
  "src/lib/ai/provider.server.ts",
  "src/lib/ai/search.server.ts",
  "src/lib/ai/deep-research.server.ts",
  "src/routes/api/chat.ts",
  "src/routes/api/health.ts",
  "supabase/migrations/20260721211500_deep_research_runs.sql",
];

test("recovery-critical provider, chat, health, and migration files are present", async () => {
  for (const file of requiredFiles) await access(file);
});

test("normal chat can degrade gracefully when optional providers are not configured", async () => {
  const provider = await readFile("src/lib/ai/provider.server.ts", "utf8");
  const search = await readFile("src/lib/ai/search.server.ts", "utf8");
  const chat = await readFile("src/routes/api/chat.ts", "utf8");
  assert.match(provider, /missingAiProviderResponse/);
  assert.match(
    provider,
    /configured: Boolean\(env\("LOVABLE_API_KEY"\) \?\? env\("OPENAI_API_KEY"\)\)/,
  );
  assert.match(provider, /validateAiProviderConfig/);
  assert.match(search, /not_configured/);
  assert.match(chat, /missingAiProviderResponse|providerUnavailableEnvelope/);
});
