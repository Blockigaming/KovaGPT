import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("Kova eval default validates all 30 smoke cases and 12 categories", () => {
  const stdout = execFileSync(process.execPath, ["scripts/model-eval.mjs"], { encoding: "utf8" });
  const result = JSON.parse(stdout);
  assert.equal(result.valid, true);
  assert.equal(result.cases, 30);
  assert.equal(result.categories.length, 12);
  for (const category of [
    "general_chat",
    "coding",
    "instruction_following",
    "reasoning_math",
    "tool_use",
    "deep_research",
    "safety_privacy",
    "factuality",
    "kova_specific",
    "agentic_execution",
    "long_context",
    "multi_turn",
  ]) {
    assert.ok(result.categories.includes(category), `missing ${category}`);
  }
});

test("default provider runner performs a no-key dry run over the same full suite", () => {
  const stdout = execFileSync(process.execPath, ["scripts/model-eval-run-openai.mjs"], {
    encoding: "utf8",
    env: { ...process.env, OPENAI_API_KEY: "" },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.cases, 30);
  assert.equal(result.live, false);
  assert.equal(result.replacement_eligible, false);
});
