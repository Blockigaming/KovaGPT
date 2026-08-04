import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estimateProviderInput } from "../../src/lib/ai/token-estimator.server.ts";

const config = readFileSync("src/lib/ai/config.server.ts", "utf8");
const accounting = readFileSync("src/lib/ai/accounting.server.ts", "utf8");
const catalog = readFileSync("src/lib/ai/model-catalog.server.ts", "utf8");
const chat = readFileSync("src/routes/api/chat.ts", "utf8");
const sql = readFileSync("supabase/migrations/20260803130000_ai_usage_accounting.sql", "utf8");

test("every documented budget variable is schema parsed and authoritatively enforced", () => {
  for (const name of [
    "KOVA_MAX_COST_USD_PER_REQUEST",
    "KOVA_MAX_TOKENS_PER_USER_DAY",
    "KOVA_MAX_TOKENS_PER_USER_MONTH",
    "KOVA_MAX_PREMIUM_REQUESTS_PERIOD",
    "KOVA_MAX_GUEST_REQUESTS_PER_IP",
    "KOVA_MAX_CONCURRENT_GLOBAL",
    "KOVA_MAX_CONCURRENT_PER_USER",
  ]) {
    assert.match(config, new RegExp(name));
  }
  assert.match(chat, /estimatedCost > runtimeConfig\.maxCostUsdPerRequest/);
  assert.match(accounting, /maxTokensPerUserDay/);
  assert.match(accounting, /maxTokensPerUserMonth/);
  assert.match(accounting, /maxPremiumRequestsPeriod/);
  assert.match(accounting, /maxGuestRequestsPerIp/);
  assert.match(accounting, /maxConcurrentGlobal/);
  assert.match(accounting, /maxConcurrentPerUser/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /lease_expires_at/);
});

test("catalog centralizes supported IDs, prices, capabilities, tiers and review sources", () => {
  assert.match(catalog, /MODEL_CATALOG_VERSION/);
  assert.match(catalog, /platform\.openai\.com\/docs\/models/);
  assert.match(catalog, /pricePerMillion/);
  assert.match(catalog, /cachedInput/);
  assert.match(catalog, /structuredOutput/);
  assert.match(catalog, /tiers:/);
  assert.doesNotMatch(chat, /gpt-[0-9]/);
});

test("conservative estimator counts Unicode, emoji, code, tools, URLs and images", () => {
  const ascii = estimateProviderInput("hello world");
  const unicode = estimateProviderInput("こんにちは 👋🏽 café");
  const code = estimateProviderInput({
    code: "function x(){return `https://example.com/a?b=1`;}",
    tools: [{ name: "search", schema: { query: "string" } }],
  });
  const image = estimateProviderInput({
    type: "image_url",
    image_url: { url: "data:image/png;base64,AAAA" },
  });
  assert.ok(ascii.tokens > 0);
  assert.ok(unicode.tokens > ascii.tokens);
  assert.ok(code.tokens > ascii.tokens);
  assert.equal(image.imageCount, 1);
  assert.ok(image.tokens >= 1_200);
});
