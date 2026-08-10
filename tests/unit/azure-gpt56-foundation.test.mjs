import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_MODELS,
  MODEL_COST_PER_MTOK,
  costPerMTok,
} from "../../src/lib/ai/model-config.mjs";
import { estimateCostUsd, routeModel } from "../../src/lib/ai/model-router.mjs";

test("GPT-5.6 role routing uses Luna, Terra, Sol, and GPT Image 2", () => {
  assert.equal(DEFAULT_MODELS.DEFAULT_CHAT, "gpt-5.6-luna");
  assert.equal(DEFAULT_MODELS.ADVANCED_REASONING, "gpt-5.6-terra");
  assert.equal(DEFAULT_MODELS.PREMIUM_REASONING, "gpt-5.6-sol");
  assert.equal(DEFAULT_MODELS.IMAGE_GENERATION, "gpt-image-2");
});

test("GPT-5.6 standard token prices match the reviewed 2026-08-10 catalog", () => {
  assert.deepEqual(MODEL_COST_PER_MTOK["gpt-5.6-luna"], { input: 1, output: 6 });
  assert.deepEqual(MODEL_COST_PER_MTOK["gpt-5.6-terra"], { input: 2.5, output: 15 });
  assert.deepEqual(MODEL_COST_PER_MTOK["gpt-5.6-sol"], { input: 5, output: 30 });
  assert.deepEqual(costPerMTok("gpt-5.6-sol"), { input: 5, output: 30 });
});

test("cost-first router reserves Sol for explicit premium modes", () => {
  assert.equal(routeModel({ task: "chat", mode: "instant", tier: "pro" }).modelId, "gpt-5.6-luna");
  assert.equal(routeModel({ task: "chat", mode: "high", tier: "pro" }).modelId, "gpt-5.6-terra");
  assert.equal(
    routeModel({ task: "chat", mode: "extra_high", tier: "pro" }).modelId,
    "gpt-5.6-sol",
  );
  assert.equal(routeModel({ task: "chat", mode: "pro", tier: "pro" }).modelId, "gpt-5.6-sol");
  assert.deepEqual(
    routeModel({ task: "chat", mode: "extra_high", tier: "plus" }),
    assert.match({
      modelId: "gpt-5.6-terra",
      downgradedFrom: "PREMIUM_REASONING",
    }),
  );
});

test("router cost estimate applies GPT-5.6 long-context multipliers", () => {
  assert.equal(estimateCostUsd("gpt-5.6-sol", 272_000, 1_000), 1.39);
  assert.equal(estimateCostUsd("gpt-5.6-sol", 272_001, 1_000), 2.76501);
});

test("provider runtime is official OpenAI Responses API only", async () => {
  const source = await readFile("src/lib/ai/provider.server.ts", "utf8");
  assert.match(source, /https:\/\/api\.openai\.com\/v1/u);
  assert.match(source, /providerFetch\(\s*"\/responses"/u);
  assert.match(source, /OPENAI_API_KEY/u);
  assert.match(source, /gpt-image-2/u);
  assert.match(source, /normalizeResponsesTools/u);
  assert.match(
    source,
    /type: "function",\s*name: definition\.name,\s*description: definition\.description,\s*parameters: definition\.parameters/su,
  );
  assert.doesNotMatch(source, /LOVABLE_API_KEY|ai\.gateway\.lovable\.dev|GATEWAY_MODEL_IDS/u);
});

test("GPT-5.6 catalog prices and long-context accounting are fail-closed", async () => {
  const source = await readFile("src/lib/ai/model-catalog.server.ts", "utf8");
  assert.match(source, /MODEL_CATALOG_VERSION = "2026-08-10"/u);
  assert.match(
    source,
    /id: "gpt-5\.6-luna"[\s\S]*?pricePerMillion: \{ input: 1, cachedInput: 0\.1, output: 6 \}/u,
  );
  assert.match(
    source,
    /id: "gpt-5\.6-terra"[\s\S]*?pricePerMillion: \{ input: 2\.5, cachedInput: 0\.25, output: 15 \}/u,
  );
  assert.match(
    source,
    /id: "gpt-5\.6-sol"[\s\S]*?pricePerMillion: \{ input: 5, cachedInput: 0\.5, output: 30 \}/u,
  );
  assert.match(source, /estimatedInputTokens > 272_000/u);
  assert.match(source, /inputMultiplier = longContext \? 2 : 1/u);
  assert.match(source, /outputMultiplier = longContext \? 1\.5 : 1/u);
});

test("visible Kova modes map to the full GPT-5.6 reasoning scale", async () => {
  const source = await readFile("src/lib/modes.ts", "utf8");
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) {
    assert.match(source, new RegExp(`reasoning: "${effort}"`, "u"));
  }
  assert.match(source, /id: "pro"[\s\S]*?reasoning: "max"/u);
});

test("environment template is unique, GPT-5.6 aligned, and contains no Lovable credential", async () => {
  const source = await readFile(".env.example", "utf8");
  const names = [...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)].map((match) => match[1]);
  assert.equal(names.length, new Set(names).size);
  assert.match(source, /^KOVA_DEEP_MODEL=gpt-5\.6-sol$/mu);
  assert.match(source, /^KOVA_MODEL_PREMIUM_REASONING=gpt-5\.6-sol$/mu);
  assert.match(source, /^KOVA_MODEL_IMAGE_GENERATION=gpt-image-2$/mu);
  assert.doesNotMatch(source, /^LOVABLE_/mu);
});

test("package metadata contains no Lovable dependency", async () => {
  for (const path of ["package.json", "package-lock.json"]) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /@lovable\.dev\//u, path);
  }
});

test("legacy Lovable credit-consuming email routes are permanently retired", async () => {
  const paths = [
    "src/routes/lovable/email/auth/preview.ts",
    "src/routes/lovable/email/auth/webhook.ts",
    "src/routes/lovable/email/queue/process.ts",
    "src/routes/lovable/email/transactional/send.ts",
  ];
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    assert.match(source, /legacy_email_provider_retired/u, path);
    assert.match(source, /status: 410/u, path);
    assert.doesNotMatch(source, /@lovable\.dev|LOVABLE_API_KEY|sendLovableEmail/u, path);
  }
});
