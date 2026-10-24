import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODELS,
  MODE_MAX_OUTPUT_TOKENS,
  ROUTING_THRESHOLDS,
  getModelConfig,
  isValidModelId,
  resolveRoleModel,
} from "../../src/lib/ai/model-config.mjs";
import {
  estimateCostUsd,
  freeModeUpgradeRequired,
  routeModel,
  scoreComplexity,
} from "../../src/lib/ai/model-router.mjs";

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
  const decision = routeModel({ task: "chat", mode: "max", tier: "pro", text: "deep analysis" });
  assert.equal(decision.role, "PREMIUM_REASONING");
  assert.equal(decision.modelId, SOL);
});

test("default request budget can admit the full Ultra output reservation", () => {
  const maximumProviderCalls = 9;
  const outputReservation =
    estimateCostUsd(SOL, 0, MODE_MAX_OUTPUT_TOKENS.ultra) * maximumProviderCalls;
  assert.ok(outputReservation <= 1);
});

test("mode output ceilings remain monotonic through Max and Ultra", () => {
  const modes = ["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"];
  for (let index = 1; index < modes.length; index += 1) {
    assert.ok(
      MODE_MAX_OUTPUT_TOKENS[modes[index]] > MODE_MAX_OUTPUT_TOKENS[modes[index - 1]],
      `${modes[index]} must exceed ${modes[index - 1]}`,
    );
  }
});

test("Free paid modes fail closed instead of selecting or downgrading a model", () => {
  for (const mode of ["medium", "thinking", "high", "extra_high", "max", "ultra", "kova_5_5"]) {
    assert.equal(freeModeUpgradeRequired("free", mode), true);
    assert.throws(
      () => routeModel({ task: "chat", mode, tier: "free", hasImages: true }),
      /mode_not_entitled/,
    );
  }
  assert.throws(
    () => routeModel({ task: "chat", mode: "instant", tier: "free", deepMode: true }),
    /mode_not_entitled/,
  );
});

test("Free basic chat keeps its existing pin even for complex prompts", () => {
  for (const mode of ["instant", "auto", "default", "fast"]) {
    assert.equal(freeModeUpgradeRequired("free", mode), false);
    const decision = routeModel({
      task: "chat",
      mode,
      tier: "free",
      text: "debug a race condition and refactor this multi-file architecture",
      needsTools: true,
    });
    assert.equal(decision.role, "DEFAULT_CHAT");
    assert.equal(decision.modelId, LUNA);
  }
});

test("Free mode guard preserves paid routing and utility tasks", () => {
  for (const tier of ["plus", "pro", "business"]) {
    assert.equal(freeModeUpgradeRequired(tier, "thinking", true), false);
  }
  assert.equal(routeModel({ task: "chat", tier: "plus", mode: "max" }).modelId, TERRA);
  assert.equal(routeModel({ task: "chat", tier: "pro", mode: "ultra" }).modelId, SOL);
  assert.equal(
    routeModel({ task: "utility", tier: "free", mode: "thinking" }).modelId,
    DEFAULT_MODELS.UTILITY,
  );
});

test("utility tasks always use the utility model with a tight output cap", () => {
  for (const utilityTask of ["chat_title", "summary", "classification", "sentiment"]) {
    const decision = routeModel({
      task: "utility",
      utilityTask,
      mode: "max",
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

test("malformed text model overrides fail closed without exposing their value", () => {
  assert.equal(isValidModelId("gpt-5.6-luna"), true);
  assert.equal(isValidModelId("changeme"), false);
  assert.equal(isValidModelId(""), false);
  for (const role of [
    "DEFAULT_CHAT",
    "ADVANCED_REASONING",
    "PREMIUM_REASONING",
    "UTILITY",
    "IMAGE_ANALYSIS",
  ]) {
    const key = `KOVA_MODEL_${role}`;
    assert.throws(
      () => resolveRoleModel(role, { [key]: "private invalid model!!" }),
      (error) => {
        assert.equal(error.message, `unsupported_ai_model:${key}`);
        assert.doesNotMatch(error.message, /private invalid model/u);
        return true;
      },
    );
  }
  assert.throws(
    () => routeModel({ task: "chat", env: { KOVA_MODEL_DEFAULT_CHAT: "bad model!!" } }),
    /unsupported_ai_model:KOVA_MODEL_DEFAULT_CHAT/u,
  );
});

test("text override validation preserves existing image and embedding model resolution", () => {
  for (const role of ["IMAGE_GENERATION", "EMBEDDING"]) {
    const key = `KOVA_MODEL_${role}`;
    const resolved = resolveRoleModel(role, { [key]: "bad model!!" });
    assert.equal(resolved.modelId, DEFAULT_MODELS[role]);
    assert.equal(resolved.source, "default");
    assert.equal(resolved.invalidOverride, "bad model!!");
  }
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
