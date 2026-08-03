import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODELS,
  ROUTING_THRESHOLDS,
  getModelConfig,
  isValidModelId,
  resolveRoleModel,
} from "../../src/lib/ai/model-config.mjs";
import { estimateCostUsd, routeModel, scoreComplexity } from "../../src/lib/ai/model-router.mjs";

const LUNA = DEFAULT_MODELS.DEFAULT_CHAT;
const TERRA = DEFAULT_MODELS.ADVANCED_REASONING;
const SOL = DEFAULT_MODELS.PREMIUM_REASONING;

test("normal chat uses the default cheapest model", () => {
  const decision = routeModel({
    task: "chat",
    mode: "instant",
    tier: "free",
    text: "what is a good dinner recipe for two people",
  });
  assert.equal(decision.role, "DEFAULT_CHAT");
  assert.equal(decision.modelId, LUNA);
});

test("long but simple prompts never upgrade the model", () => {
  const decision = routeModel({
    task: "chat",
    mode: "medium",
    tier: "pro",
    text: "please summarize this ".repeat(2000),
    contextChars: 120_000,
  });
  assert.equal(decision.role, "DEFAULT_CHAT");
  assert.equal(decision.modelId, LUNA);
});

test("thinking mode upgrades to the advanced model", () => {
  const decision = routeModel({ task: "chat", mode: "thinking", tier: "plus", text: "hello" });
  assert.equal(decision.role, "ADVANCED_REASONING");
  assert.equal(decision.modelId, TERRA);
});

test("genuinely complex paid work auto-upgrades to advanced", () => {
  const decision = routeModel({
    task: "chat",
    mode: "medium",
    tier: "plus",
    text: "help me debug this race condition and then refactor the multi-file architecture",
  });
  assert.equal(decision.role, "ADVANCED_REASONING");
  assert.ok(decision.complexityScore >= ROUTING_THRESHOLDS.advancedComplexityScore);
});

test("deep mode upgrades to the premium model for premium tiers", () => {
  const decision = routeModel({ task: "chat", mode: "pro", tier: "pro", text: "deep analysis" });
  assert.equal(decision.role, "PREMIUM_REASONING");
  assert.equal(decision.modelId, SOL);
});

test("free users can never reach the premium model", () => {
  const decision = routeModel({
    task: "chat",
    mode: "pro",
    tier: "free",
    deepMode: true,
    text: "extremely difficult reasoning",
  });
  assert.notEqual(decision.modelId, SOL);
  assert.equal(decision.role, "DEFAULT_CHAT");
  assert.equal(decision.downgradedFrom, "PREMIUM_REASONING");
});

test("utility tasks always use the utility model with a tight output cap", () => {
  for (const utilityTask of ["chat_title", "summary", "classification", "sentiment"]) {
    const decision = routeModel({
      task: "utility",
      utilityTask,
      mode: "pro",
      tier: "pro",
      deepMode: true,
      text: "difficult debugging refactor architecture proof",
    });
    assert.equal(decision.role, "UTILITY");
    assert.equal(decision.modelId, DEFAULT_MODELS.UTILITY);
    assert.notEqual(decision.modelId, SOL);
    assert.notEqual(decision.modelId, TERRA);
    assert.ok(decision.maxOutputTokens <= 256);
  }
});

test("routing decisions carry logging and cost metadata", () => {
  const decision = routeModel({ task: "chat", mode: "medium", tier: "plus", text: "hi" });
  assert.ok(Array.isArray(decision.reasons) && decision.reasons.length > 0);
  assert.equal(typeof decision.estimatedCostUsd, "number");
  assert.ok(decision.estimatedCostUsd >= 0);
  assert.ok(estimateCostUsd(SOL, 1_000_000, 0) > estimateCostUsd(LUNA, 1_000_000, 0));
});

test("invalid model overrides fail safe to built-in defaults", () => {
  assert.equal(isValidModelId("gpt-5.6-luna"), true);
  assert.equal(isValidModelId("changeme"), false);
  assert.equal(isValidModelId(""), false);
  const resolved = resolveRoleModel("DEFAULT_CHAT", { KOVA_MODEL_DEFAULT_CHAT: "bad model!!" });
  assert.equal(resolved.modelId, LUNA);
  assert.equal(resolved.source, "default");
  assert.equal(resolved.invalidOverride, "bad model!!");
});

test("environment overrides migrate models without code changes", () => {
  const config = getModelConfig({
    KOVA_MODEL_DEFAULT_CHAT: "gpt-5.7-luna",
    KOVA_MODEL_PREMIUM_REASONING: "gpt-5.7-sol",
  });
  assert.equal(config.DEFAULT_CHAT, "gpt-5.7-luna");
  assert.equal(config.PREMIUM_REASONING, "gpt-5.7-sol");
  assert.equal(config.ADVANCED_REASONING, TERRA);
  const routed = routeModel({
    task: "chat",
    mode: "instant",
    tier: "free",
    text: "hello",
    env: { KOVA_MODEL_DEFAULT_CHAT: "gpt-5.7-luna" },
  });
  assert.equal(routed.modelId, "gpt-5.7-luna");
});

test("the frontend cannot override the selected model", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8"),
  );
  assert.match(source, /routeAiModel\(/);
  assert.doesNotMatch(source, /body\.model\s*=\s*(?:payload|clientBody)/);
  const complexity = scoreComplexity("prove this theorem and derive the optimization problem");
  assert.ok(complexity.score >= 2);
});
