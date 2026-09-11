import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlindJudgeInput, parseJudgeResult } from "../../scripts/model-eval-judge-openai.mjs";

test("blind judge payload omits candidate identity", () => {
  const text = buildBlindJudgeInput(
    { prompt: "Explain X", grader: { criteria: ["correct", "clear"] } },
    "Answer A",
  );
  const payload = JSON.parse(text);
  assert.equal(payload.task, "Explain X");
  assert.deepEqual(payload.rubric, ["correct", "clear"]);
  assert.equal(payload.candidate_answer, "Answer A");
  assert.equal("model" in payload, false);
  assert.equal("provider" in payload, false);
});

test("judge parser accepts bounded score and rejects invalid score", () => {
  assert.deepEqual(parseJudgeResult('{"score":0.75,"rationale":"Mostly correct"}'), {
    score: 0.75,
    rationale: "Mostly correct",
  });
  assert.throws(() => parseJudgeResult('{"score":1.5,"rationale":"bad"}'), /between 0 and 1/u);
});
