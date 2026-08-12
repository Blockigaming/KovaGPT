import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("AI provider adapter exposes typed capabilities and safe errors", () => {
  const source = read("src/lib/ai/provider.server.ts");
  for (const token of [
    "ProviderCapability",
    "ProviderErrorEnvelope",
    "ProviderConfig",
    "AiProviderError",
    "getAiProviderConfig",
    "validateAiProviderConfig",
    "supportsProviderCapability",
    "providerUnavailableEnvelope",
    "providerErrorFromResponse",
    "providerErrorResponse",
    "streamingChatCompletions",
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`), `provider adapter should include ${token}`);
  }
});

test("AI requests are locked to approved direct or managed OpenAI endpoints", () => {
  const source = read("src/lib/ai/provider.server.ts");
  assert.match(source, /const OPENAI_API_BASE_URL = "https:\/\/api\.openai\.com\/v1"/);
  assert.match(source, /provider: "openai"/);
  assert.match(source, /redirect: "error"/);
  assert.doesNotMatch(source, /OPENAI_BASE_URL|AI_PROVIDER_URL|AI_PROVIDER_API_KEY/);
  assert.match(source, /LOVABLE_GATEWAY_BASE_URL = "https:\/\/ai\.gateway\.lovable\.dev\/v1"/);
  assert.doesNotMatch(source, /LOVABLE_AI_BASE_URL|Lovable-API-Key/i);
  assert.doesNotMatch(source, /VITE_.*API_KEY/);
});

test("provider failures expose only KovaGPT-generic non-cacheable envelopes", () => {
  const source = read("src/lib/ai/provider.server.ts");
  for (const token of [
    "provider_timeout",
    "provider_rate_limited",
    "provider_unavailable",
    "provider_bad_response",
    "model_provider_failure",
    "Cache-Control",
    "no-store",
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /KovaGPT is temporarily unavailable/);
  assert.doesNotMatch(source, /missing_openai_api_key|provider_auth_failed|provider_network_error/);
  assert.doesNotMatch(source, /response\.text\(|providerMessage/);
  assert.match(source, /response\.body\?\.cancel\(\)/);
  assert.match(source, /response\.status === 402/);
});

test("AI provider environment knobs are documented without values that look like secrets", () => {
  const env = read(".env.example");
  assert.match(env, /^KOVA_AI_TIMEOUT_MS=45000$/m);
  assert.match(env, /^KOVA_AI_CAPABILITIES=$/m);
  assert.doesNotMatch(env, /OPENAI_API_KEY=sk-/);
  assert.doesNotMatch(env, /^OPENAI_BASE_URL=/m);
});
