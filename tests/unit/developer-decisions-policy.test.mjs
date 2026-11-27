import assert from "node:assert/strict";
import test from "node:test";
import {
  developerDecisionFields,
  validDeveloperDecisionRequest,
  developerDecisionUsage,
  validateDeveloperDecisionResult,
  readDeveloperDecisionResponse,
} from "../../src/lib/pricing/developer-decisions-policy.mjs";

const input = {
  model: "gpt-6-luna",
  input: "A customer asks about shipping.",
  questions: [
    { type: "predicate", name: "shipping", instructions: "Is this about delivery?" },
    { type: "choice", name: "topic", instructions: "Classify", choices: [{ value: "shipping" }, { value: false }] },
    { type: "score", name: "priority", instructions: "Rate priority", levels: [{ label: "Low" }, { label: "High" }] },
  ],
};
const usage = {
  input_tokens: 100,
  output_tokens: 2,
  total_tokens: 102,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
};
const result = {
  model: input.model,
  usage,
  answers: [
    { type: "predicate", name: "shipping", probability: 0.9 },
    { type: "choice", name: "topic", confidence: 0.8, choice: "shipping", probabilities: [{ value: "shipping", probability: 0.8 }, { value: false, probability: 0.2 }] },
    { type: "score", name: "priority", confidence: 0.7, score: 0.25, probabilities: [{ value: 0, label: "Low", probability: 0.75 }, { value: 1, label: "High", probability: 0.25 }] },
  ],
};
test("decisions use bounded typed questions and disable implicit caching", () => {
  const fields = developerDecisionFields(input);
  assert.deepEqual(fields.prompt_cache_options, { mode: "explicit" });
  assert.equal(validDeveloperDecisionRequest({ model: input.model, ...fields }), true);
  assert.equal(validDeveloperDecisionRequest({ model: "different", ...fields }), false);
  assert.equal(validDeveloperDecisionRequest({ model: input.model, ...fields, prompt_cache_options: { mode: "implicit" } }), false);
  for (const patch of [
    { questions: [] },
    { questions: Array(17).fill(input.questions[0]) },
    { questions: [input.questions[0], input.questions[0]] },
    { input: [{ type: "input_image", image_url: "https://example.invalid" }] },
    { questions: [{ ...input.questions[1], choices: [{ value: false }, { value: false }] }] },
    { prompt_cache_key: "caller" },
  ]) assert.throws(() => developerDecisionFields({ ...input, ...patch }), /decision_invalid/);
});
test("native receipts have an independent noncached billing dimension", () => {
  assert.deepEqual(developerDecisionUsage(usage), { decision_input_tokens: 100 });
  for (const patch of [
    { total_tokens: 99 },
    { input_tokens: -1 },
    { input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 } },
    { input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 } },
    { input_tokens_details: {} },
  ]) assert.equal(developerDecisionUsage({ ...usage, ...patch }), null);
});
test("decisions validate exact question identity, distributions and refusals", () => {
  const normalize = (value) => validateDeveloperDecisionResult(value, input.questions, [input.model], "kova-decision");
  assert.equal(normalize(result).model, "kova-decision");
  assert.deepEqual(normalize(result).answers, result.answers);
  const refusal = structuredClone(result);
  refusal.answers[0] = { name: "shipping", type: "refusal", internal: "hidden" };
  assert.deepEqual(normalize(refusal).answers[0], { name: "shipping", type: "refusal" });
  for (const mutate of [
    (value) => value.answers.reverse(),
    (value) => value.answers[1].choice = "invented",
    (value) => value.answers[1].probabilities[1].value = "shipping",
    (value) => value.answers[2].score = 0.9,
    (value) => value.answers[0].probability = 1.1,
    (value) => value.model = "different",
  ]) {
    const value = structuredClone(result);
    mutate(value);
    assert.throws(() => normalize(value), /provider_unavailable/);
  }
});
test("native response reader rejects malformed data and exposes only validated output", async () => {
  const read = (response) => readDeveloperDecisionResponse(response, input.questions, [input.model], "kova-decision");
  assert.equal((await read(Response.json(result))).model, "kova-decision");
  await assert.rejects(read(new Response("not json")), /provider_unavailable/);
  await assert.rejects(read(Response.json({ ...result, usage: null })), /provider_unavailable/);
});
