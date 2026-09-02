import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const provider = read("src/lib/ai/provider.server.ts");
const transport = read("src/lib/ai/provider-transport.server.mjs");
const catalog = read("src/lib/ai/model-catalog.server.ts");
const chat = read("src/routes/api/chat.ts");
const image = read("src/routes/api/generate-image.ts");
const search = read("src/lib/ai/search.server.ts");
const config = read("src/lib/ai/config.server.ts");

test("GPT-5.6 Sol remains the highest-capability server-selected model", () => {
  assert.match(catalog, /id: "gpt-5\.6-sol"/u);
  assert.match(catalog, /deep:[\s\S]{0,220}?fallback: "gpt-5\.6-sol"/u);
  assert.match(catalog, /id: "gpt-5\.6-sol"[\s\S]{0,600}?reasoning: true/u);
  assert.match(catalog, /id: "gpt-5\.6-sol"[\s\S]{0,600}?vision: true/u);
  assert.match(catalog, /id: "gpt-5\.6-sol"[\s\S]{0,600}?tools: true/u);
  assert.doesNotMatch(chat, /body\.(?:model|modelId)|parsed\.(?:model|modelId)/u);
});

test("the approved provider path supports Responses streaming and Azure managed identity", () => {
  assert.match(provider, /providerFetch\(\s*"\/responses"/u);
  assert.match(provider, /responsesStreamToChatStream/u);
  assert.match(provider, /AZURE_OPENAI_DEPLOYMENT_DEEP/u);
  assert.match(transport, /IDENTITY_ENDPOINT/u);
  assert.match(transport, /IDENTITY_HEADER/u);
  assert.match(transport, /AZURE_CLIENT_ID/u);
  assert.match(provider, /Bearer \$\{await fetchManagedIdentityToken\(signal\)\}/u);
  assert.match(provider, /provider_timeout/u);
  assert.match(provider, /provider_rate_limited/u);
  assert.match(provider, /provider_unavailable/u);
  assert.match(provider, /KOVA_AI_TIMEOUT_MS/u);
  assert.match(transport, /createRequestDeadline/u);
  assert.match(transport, /wrapResponseBodyWithDeadline/u);
  assert.doesNotMatch(provider, /VITE_.*(?:OPENAI|AZURE).*KEY/iu);
});

test("chat, tools, search, files, vision, and image workflows remain server-gated", () => {
  assert.match(chat, /getCallerTier\(auth\)/u);
  assert.match(chat, /MAX_TOOL_CALLS_TOTAL/u);
  assert.match(chat, /request\.signal/u);
  assert.match(chat, /attachment/iu);
  assert.match(chat, /reasoning/iu);
  assert.match(search, /FIRECRAWL_API_KEY/u);
  assert.match(image, /enforceQuota/u);
  assert.match(provider, /file_analysis/u);
  assert.match(provider, /vision/u);
  assert.match(provider, /image_generation/u);
  assert.match(config, /KOVA_GENERATION_DISABLED/u);
});
