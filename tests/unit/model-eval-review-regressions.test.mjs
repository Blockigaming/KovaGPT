import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRuns } from "../../scripts/model-eval-compare.mjs";
import { digest } from "../../scripts/model-eval-contract.mjs";
import { gradeDeterministic } from "../../scripts/model-eval-grade.mjs";
import { judgeCase, judgeRows, parseJudgeResult } from "../../scripts/model-eval-judge-openai.mjs";

function run(model = "actual-candidate") {
  return ["a", "b"].map((id) => ({
    id,
    category: "general_chat",
    status: "completed",
    score: 1,
    model: "requested-alias",
    returned_model: model,
    run_id: "fixture-run",
    case_sha256: digest(id),
    suite_sha256: digest("suite"),
    inference_sha256: digest("inference"),
    scoring_sha256: digest("scoring"),
    grade_method: "blind-rubric-judge",
    judge_returned_model: "actual-judge",
  }));
}

const item = {
  id: "a",
  category: "general_chat",
  prompt: "Explain the example",
  grader: { type: "rubric", criteria: ["Correct explanation"] },
};
const options = {
  apiKey: "test-fixture-not-a-key",
  model: "judge-alias",
  item,
  output: "A candidate response",
  timeoutMs: 1000,
};
const answer = (extra = {}) =>
  new Response(
    JSON.stringify({
      status: "completed",
      model: "actual-judge-revision",
      output_text: '{"score":0.75,"rationale":"Correct except for one detail"}',
      ...extra,
    }),
    { status: 200 },
  );

test("different candidate models are comparable but mixed models within one run are not", () => {
  const result = compareRuns(run("reference-snapshot"), run("candidate-snapshot"));
  assert.equal(result.provenance_complete, true);
  assert.equal(result.actual_models.reference, "reference-snapshot");
  assert.equal(result.actual_models.candidate, "candidate-snapshot");
  const mixed = run();
  mixed[1].returned_model = "changed-under-alias";
  assert.throws(() => compareRuns(run(), mixed), /Mixed returned_model/u);
});

for (const returned_model of [undefined, null, "", "  ", 42, false]) {
  test(`missing or malformed actual model identity is unverified: ${String(returned_model)}`, () => {
    const candidate = run();
    candidate[0].returned_model = returned_model;
    assert.equal(compareRuns(run(), candidate).provenance_complete, false);
  });
}

test("unknown and failed generations cannot imply complete execution provenance", () => {
  const candidate = run();
  candidate[0].status = "error";
  candidate[0].score = 0;
  candidate[0].returned_model = "error-route-is-not-a-completed-model";
  assert.equal(compareRuns(run(), candidate).provenance_complete, false);
});

test("judge model must be consistent within each run and compatible across runs", () => {
  const changed = run().map((row) => ({ ...row, judge_returned_model: "new-judge" }));
  assert.throws(() => compareRuns(run(), changed), /Actual judge model mismatch/u);
  const mixed = run();
  mixed[0].judge_returned_model = "new-judge";
  assert.throws(() => compareRuns(run(), mixed), /Mixed judge_returned_model/u);
});

test("missing judge identity marks the run unverified without inventing a fallback", () => {
  const missing = run();
  delete missing[0].judge_returned_model;
  assert.equal(compareRuns(run(), missing).provenance_complete, false);
});

test("fully deterministic runs do not require a judge identity", () => {
  const deterministic = run().map((row) => ({
    ...row,
    grade_method: "deterministic-exact",
    judge_returned_model: undefined,
  }));
  assert.equal(compareRuns(deterministic, deterministic).provenance_complete, true);
});

test("judge requests enforce Responses text.format schema without changing store:false", async () => {
  let request;
  await judgeCase({
    ...options,
    fetcher: async (_url, init) => {
      request = JSON.parse(init.body);
      return answer();
    },
  });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.deepEqual(request.text.format.schema.required, ["score", "rationale"]);
  assert.equal(request.text.format.schema.properties.score.type, "number");
  assert.equal("response_format" in request, false);
});

test("actual judge identity survives individual grading and whole-run judging", async () => {
  const individual = await judgeCase({ ...options, fetcher: async () => answer() });
  assert.equal(individual.judge_returned_model, "actual-judge-revision");
  const rows = await judgeRows(
    [item],
    [{ id: item.id, status: "completed", output: "candidate answer" }],
    { ...options, fetcher: async () => answer() },
  );
  assert.equal(rows[0].judge_returned_model, "actual-judge-revision");
  assert.equal(rows[0].judge_model, "judge-alias");
});

test("no returned judge identity remains null", async () => {
  const result = await judgeCase({
    ...options,
    fetcher: async () => answer({ model: undefined }),
  });
  assert.equal(result.judge_returned_model, null);
});

test("invalid structured outputs still fail closed at the local boundary", () => {
  assert.throws(() => parseJudgeResult('{"score":1,"rationale":"ok","extra":true}'), /fields/u);
  assert.throws(() => parseJudgeResult('{"score":1,"rationale":"  "}'), /rationale/u);
  assert.throws(() => parseJudgeResult('{"score":null,"rationale":"ok"}'), /score/u);
});

for (const [expected, wrong] of [
  ["DELETE", "delete"],
  ["$HOME", "HOME"],
  ["a  b", "a b"],
  ["line\nbreak", "line break"],
  ["ID-AB", " ID-AB "],
]) {
  test(`exact literal preserves significant characters: ${JSON.stringify(expected)}`, () => {
    const exact = { grader: { type: "exact", answer: expected } };
    assert.equal(gradeDeterministic(exact, expected).score, 1);
    assert.equal(gradeDeterministic(exact, wrong).score, 0);
  });
}

test("decimal equivalence is exact, including integers beyond float precision", () => {
  const grade = (expected, output) =>
    gradeDeterministic({ grader: { type: "exact", answer: expected } }, output).score;
  assert.equal(grade("194.40", " $194.400 "), 1);
  assert.equal(grade("48", "048.00"), 1);
  assert.equal(grade("0", "-0.000"), 1);
  assert.equal(grade("9007199254740992", "9007199254740993"), 0);
  assert.equal(grade("0.000000000000000000001", "0"), 0);
});
