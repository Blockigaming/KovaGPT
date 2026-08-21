import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync("src/lib/ai/provider.server.ts", "utf8");
const chat = readFileSync("src/routes/api/chat.ts", "utf8");
const env = readFileSync(".env.example", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260803130000_ai_usage_accounting.sql",
  "utf8",
);
const config = readFileSync("src/lib/ai/config.server.ts", "utf8");
const catalog = readFileSync("src/lib/ai/model-catalog.server.ts", "utf8");

test("normal AI calls use the Responses API through the approved direct provider adapter", () => {
  assert.match(provider, /providerFetch\(\s*"\/responses"/);
  assert.match(provider, /https:\/\/api\.openai\.com\/v1/);
  assert.match(provider, /\.openai\.azure\.com/);
  assert.match(provider, /\.services\.ai\.azure\.com/);
  assert.match(provider, /responsesStreamToChatStream/);
  assert.doesNotMatch(provider, /lovable\.(?:app|dev)|LOVABLE_|@lovable\.dev/iu);
  assert.doesNotMatch(provider, /OPENAI_BASE_URL|AI_PROVIDER_URL|VITE_.*API_KEY/);
});

test("provider fails closed for missing credentials and the Kova generation kill switch", () => {
  assert.match(config, /KOVA_GENERATION_DISABLED/);
  assert.match(provider, /OPENAI_API_KEY/);
  assert.match(provider, /AZURE_OPENAI_API_KEY/);
  assert.match(provider, /IDENTITY_ENDPOINT/);
  assert.match(provider, /status:\s*503/);
  assert.doesNotMatch(env, /VITE_OPENAI|VITE_LOVABLE|OPENAI_API_KEY=sk-/);
});

test("server owns entitlement, context, tools, abort, and output ceilings", () => {
  assert.match(chat, /getCallerTier\(auth\)/);
  assert.match(chat, /messages\.slice\(-HISTORY_TURNS\)/);
  assert.match(chat, /MAX_TOOL_CALLS_TOTAL = 16/);
  assert.match(chat, /signal: request\.signal/);
  assert.match(chat, /max_completion_tokens:\s*modelForPolicy/);
  assert.match(catalog, /instant:[\s\S]{0,150}?maxOutput:\s*1_200/);
  assert.match(catalog, /deep:[\s\S]{0,150}?maxOutput:\s*16_000/);
});

test("usage schema excludes prompt and response bodies", () => {
  assert.match(migration, /input_tokens/);
  assert.match(migration, /estimated_cost_usd/);
  assert.match(migration, /idempotency_key/);
  assert.doesNotMatch(migration, /prompt\s+(?:text|jsonb)|response_body|response_text/);
});
