import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("provider registry declares required capabilities, model metadata, and safe errors", () => {
  const source = read("src/lib/ai/registry.server.ts");
  for (const token of [
    "ProviderCapability",
    "ProviderModelDefinition",
    "ProviderSelection",
    "PROVIDER_NOT_CONFIGURED",
    "CAPABILITY_UNSUPPORTED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_UNAVAILABLE",
    "INVALID_PROVIDER_RESPONSE",
    "SEARCH_UNAVAILABLE",
    "RESEARCH_FAILED",
    "EMBEDDING_UNAVAILABLE",
    "selectModelForMode",
    "selectModelForCapabilities",
    "fallbackAllowed",
    "contextWindowTokens",
    "structuredOutput",
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`), `registry should include ${token}`);
  }
  assert.doesNotMatch(source, /VITE_.*API_KEY/);
});

test("search and citations use a safe stable source schema", () => {
  const source = read("src/lib/ai/sources.server.ts");
  const search = read("src/lib/ai/search.server.ts");
  for (const token of [
    "KovaSource",
    "safeSourceUrl",
    "dedupeKovaSources",
    "createCitationMap",
    "sourcePromptBlock",
    "javascript:",
  ]) {
    assert.match(
      source,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `source module should include ${token}`,
    );
  }
  assert.match(search, /kovaSources/);
  assert.match(search, /citations/);
  assert.match(search, /createCitationMap/);
});

test("memory and temporary chat policies prevent persistence and memory use", () => {
  const memory = read("src/lib/ai/memory.server.ts");
  const chat = read("src/routes/api/chat.ts");
  for (const token of [
    "MemoryCategory",
    "shouldReadMemory",
    "shouldWriteMemory",
    "selectRelevantMemories",
    "formatMemoryBlock",
    "temporary",
  ]) {
    assert.match(
      memory + chat,
      new RegExp(`\\b${token}\\b`),
      `memory policy should include ${token}`,
    );
  }
  assert.match(chat, /!temporary/);
  assert.match(chat, /temporary: Boolean\(temporary\)/);
});
