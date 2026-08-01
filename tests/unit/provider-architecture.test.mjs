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

test("AI provider adapter keeps secrets server side and normalizes retryable failures", () => {
  const source = read("src/lib/ai/provider.server.ts");
  assert.doesNotMatch(source, /VITE_.*API_KEY/);
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /provider: "openai"/);
  assert.doesNotMatch(source, /LOVABLE_API_KEY|LOVABLE_AI_BASE_URL|Lovable-API-Key/i);
  assert.match(source, /provider_timeout/);
  assert.match(source, /provider_rate_limited/);
  assert.match(source, /provider_auth_failed/);
  assert.match(source, /provider_network_error/);
  assert.match(source, /retryable: true/);
  assert.match(source, /retryable: false/);
});

test("AI provider environment knobs are documented without values that look like secrets", () => {
  const env = read(".env.example");
  assert.match(env, /^KOVA_AI_TIMEOUT_MS=45000$/m);
  assert.match(env, /^KOVA_AI_CAPABILITIES=$/m);
  assert.doesNotMatch(env, /OPENAI_API_KEY=sk-/);
});
