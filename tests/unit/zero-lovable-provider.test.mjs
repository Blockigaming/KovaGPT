import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("AI runtime has no Lovable gateway, key, model namespace, or fallback", () => {
  const files = [
    "src/lib/ai/provider.server.ts",
    "src/lib/ai/provider-transport.server.mjs",
    "src/lib/ai/config.server.ts",
    "src/lib/ai/registry.server.ts",
    "src/lib/config/diagnostics.server.ts",
    "src/lib/readiness.server.ts",
    "src/lib/azure-runtime-env.server.ts",
    ".env.example",
  ];
  const source = files.map(read).join("\n");
  for (const pattern of [
    /ai\.gateway\.lovable\.dev/iu,
    /LOVABLE_API_KEY/u,
    /LOVABLE_AI_BASE_URL/u,
    /Lovable-API-Key/u,
    /openai\/gpt-/u,
  ]) {
    assert.doesNotMatch(source, pattern);
  }
});

test("provider endpoint selection is restricted to direct OpenAI or validated Azure hosts", () => {
  const provider = read("src/lib/ai/provider.server.ts");
  assert.match(provider, /const OPENAI_API_BASE_URL = "https:\/\/api\.openai\.com\/v1"/u);
  assert.match(provider, /\.openai\.azure\.com/u);
  assert.match(provider, /\.services\.ai\.azure\.com/u);
  assert.match(provider, /endpoint\.protocol !== "https:"/u);
  assert.match(provider, /endpoint\.username/u);
  assert.match(provider, /endpoint\.password/u);
  assert.match(provider, /redirect: "error"/u);
  assert.doesNotMatch(provider, /OPENAI_BASE_URL|AI_PROVIDER_(?:URL|API_KEY)/u);
});

test("Azure OpenAI supports API-key and bounded Container Apps managed identity authentication", () => {
  const provider = read("src/lib/ai/provider.server.ts");
  const transport = read("src/lib/ai/provider-transport.server.mjs");
  const azure = read("src/lib/azure-runtime-env.server.ts");
  const runtime = `${provider}\n${transport}`;
  assert.match(provider, /"api-key": env\("AZURE_OPENAI_API_KEY"\)!/u);
  assert.match(runtime, /IDENTITY_ENDPOINT/u);
  assert.match(runtime, /IDENTITY_HEADER/u);
  assert.match(runtime, /X-IDENTITY-HEADER/u);
  assert.match(runtime, /https:\/\/cognitiveservices\.azure\.com/u);
  assert.match(transport, /createRequestDeadline/u);
  assert.match(transport, /wrapResponseBodyWithDeadline/u);
  assert.match(azure, /AZURE_OPENAI_API_KEY/u);
  assert.match(azure, /Container Apps managed identity/u);
});

test("GPT-5.6 Sol remains the highest-capability deep default", () => {
  const config = read("src/lib/ai/model-config.mjs");
  const catalog = read("src/lib/ai/model-catalog.server.ts");
  assert.match(config, /PREMIUM_REASONING\s*:\s*"gpt-5\.6-sol"/u);
  assert.match(catalog, /deep\s*:[\s\S]*fallback\s*:\s*"gpt-5\.6-sol"/u);
});

test("provider and registry expose no voice-only capability contract", () => {
  const source = read("src/lib/ai/provider.server.ts") + read("src/lib/ai/registry.server.ts");
  assert.doesNotMatch(
    source,
    /speech_to_text|text_to_speech|realtime_voice|voiceMode|startListening|stopListening/u,
  );
});
