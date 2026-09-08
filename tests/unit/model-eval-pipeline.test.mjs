import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_CASES, digest } from "../../scripts/model-eval-contract.mjs";
import { runOpenAiCase } from "../../scripts/model-eval-run-openai.mjs";
import { gradeRows } from "../../scripts/model-eval-grade.mjs";
import { judgeRows } from "../../scripts/model-eval-judge-openai.mjs";
import { scoreRun } from "../../scripts/model-eval.mjs";
import { compareRuns } from "../../scripts/model-eval-compare.mjs";

const cases = (await readFile(DEFAULT_CASES, "utf8")).trim().split("\n").map(JSON.parse);
const inference = digest({ protocol: "mock-pipeline-test", max_output_tokens: 512 });
const pricing = { inputUsdPerMtok: 2, outputUsdPerMtok: 8 };

// These fabricated fixtures exercise software contracts, not model intelligence.
function mockResponse(output, usage = { input_tokens: 100, output_tokens: 25 }) {
  return new Response(
    JSON.stringify({ id: "fixture-response", status: "completed", output_text: output, usage }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function fixtureAnswer(item) {
  if (item.grader.type === "exact") return item.grader.answer;
  if (item.grader.type === "constraints") return "apple\nbanana\npear";
  return `Mock answer for ${item.id}; not a measured model result.`;
}

async function runFixtures(model) {
  const rows = [];
  for (const item of cases) {
    const row = await runOpenAiCase({
      apiKey: "non-secret-test-fixture",
      item,
      model,
      reasoningEffort: "none",
      maxOutputTokens: 512,
      timeoutMs: 1000,
      ...pricing,
      fetcher: async (_url, init) => {
        const request = JSON.parse(init.body);
        assert.equal(request.input, item.prompt);
        assert.equal(request.store, false);
        return mockResponse(fixtureAnswer(item));
      },
    });
    rows.push({
      ...row,
      run_id: `mock-${model}`,
      suite_sha256: digest(cases),
      inference_sha256: inference,
    });
  }
  return rows;
}

function judgeOptions(score = 0.75, usage) {
  return {
    apiKey: "non-secret-test-fixture",
    model: "fixture-judge",
    ...pricing,
    fetcher: async () =>
      mockResponse(JSON.stringify({ score, rationale: "Synthetic software-test grade" }), usage),
  };
}

test("all 30 smoke cases survive mocked runner, grader, judge, score and comparison", async () => {
  const referenceRaw = await runFixtures("a");
  const reference = await judgeRows(cases, gradeRows(cases, referenceRaw), judgeOptions());
  const candidateRaw = await runFixtures("b");
  const candidate = await judgeRows(cases, gradeRows(cases, candidateRaw), judgeOptions());
  const report = scoreRun(cases, reference);
  assert.equal(report.cases, 30);
  assert.equal(Object.keys(report.categories).length, 12);
  assert.deepEqual(reference.map((row) => row.id), cases.map((item) => item.id));
  assert.ok(reference.every((row) => row.category !== undefined && row.weight === 1));
  assert.equal(report.operational.completeness.cost_usd.complete, true);
  assert.equal(report.operational.completeness.judge_cost_usd.complete, true);
  assert.equal(report.replacement_eligible, false);
  const comparison = compareRuns(reference, candidate);
  assert.equal(comparison.provenance_complete, true);
  assert.equal(comparison.relative_quality, 1);
  assert.equal(comparison.cost_ratio, 1);
  assert.equal(comparison.replacement_eligible, false);
});

test("interrupted runs retain missing cases and unknown costs", async () => {
  const raw = await runFixtures("interrupted");
  const missingId = raw[5].id;
  const partial = raw.filter((row) => row.id !== missingId);
  const graded = gradeRows(cases, partial);
  const missing = graded.find((row) => row.id === missingId);
  assert.equal(graded.length, cases.length);
  assert.equal(missing.status, "missing");
  assert.equal(missing.score, 0);
  assert.equal(missing.grade_method, "request-failure");
  const judged = await judgeRows(cases, graded, judgeOptions());
  const report = scoreRun(cases, judged);
  assert.equal(report.cases, 30);
  assert.equal(report.operational.total_cost_usd, null);
  assert.equal(report.operational.completeness.cost_usd.observed_count, 29);
  assert.equal(report.operational.p95_latency_ms, null);
  assert.equal(report.replacement_eligible, false);
});

test("pipeline refuses pending or coerced scores instead of producing a final report", async () => {
  const raw = await runFixtures("pending");
  const deterministic = gradeRows(cases, raw);
  assert.ok(deterministic.some((row) => row.score === null));
  assert.throws(() => scoreRun(cases, deterministic), /score/u);
  const judged = await judgeRows(cases, deterministic, judgeOptions());
  for (const score of [null, true, false, "", "0.75"]) {
    const altered = judged.map((row, index) => (index === 0 ? { ...row, score } : row));
    assert.throws(() => scoreRun(cases, altered), /score/u);
  }
});

test("matching IDs cannot conceal different prompt or inference hashes", async () => {
  const judged = await judgeRows(cases, await runFixtures("hashes"), judgeOptions());
  for (const key of ["case_sha256", "suite_sha256", "inference_sha256", "scoring_sha256"]) {
    const altered = judged.map((row) => ({ ...row, [key]: digest("different") }));
    assert.throws(() => compareRuns(judged, altered), /mismatch/u);
  }
  assert.throws(() => compareRuns(judged, [...judged, judged[0]]), /Duplicate/u);
});

test("a failed rubric call preserves previously checkpointed judgments", async () => {
  const subset = cases.filter((item) => item.category === "general_chat").slice(0, 2);
  const raw = subset.map((item) => ({ id: item.id, status: "completed", output: "fixture" }));
  const checkpoints = [];
  let calls = 0;
  await assert.rejects(
    judgeRows(subset, raw, {
      ...judgeOptions(),
      fetcher: async () => {
        calls += 1;
        if (calls === 2) return new Response("unavailable", { status: 503 });
        return mockResponse('{"score":0.5,"rationale":"Synthetic software-test grade"}');
      },
      onRow: async (row) => checkpoints.push(row),
    }),
    /unsuccessful/u,
  );
  assert.equal(calls, 2);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].id, subset[0].id);
  assert.equal(checkpoints[0].score, 0.5);
});

test("missing judge usage stays unknown rather than becoming a free judgment", async () => {
  const raw = await runFixtures("unknown-cost");
  const judged = await judgeRows(cases, raw, judgeOptions(0.75, null));
  const report = scoreRun(cases, judged);
  assert.notEqual(report.operational.total_cost_usd, null);
  assert.equal(report.operational.total_judge_cost_usd, null);
  assert.equal(report.operational.completeness.judge_cost_usd.complete, false);
});
