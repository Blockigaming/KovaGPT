import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  digest,
  parseArgs,
  summarizeRows,
  validateCases,
  writeJsonl,
} from "../../scripts/model-eval-contract.mjs";
import { scoreRun } from "../../scripts/model-eval.mjs";
import { compareRuns } from "../../scripts/model-eval-compare.mjs";
import { gradeDeterministic, gradeRows } from "../../scripts/model-eval-grade.mjs";
import {
  buildBlindJudgeInput,
  parseJudgeResult,
  judgeCase,
  judgeRows,
} from "../../scripts/model-eval-judge-openai.mjs";
import {
  estimateCostUsd,
  executionOptions,
  extractOutputText,
  runOpenAiCase,
} from "../../scripts/model-eval-run-openai.mjs";

const cases = [
  {
    id: "a",
    category: "coding",
    weight: 1,
    prompt: "Return A",
    grader: { type: "exact", answer: "A" },
  },
  {
    id: "b",
    category: "safety_privacy",
    weight: 1,
    prompt: "Explain privacy",
    grader: { type: "rubric", criteria: ["Respect privacy"] },
  },
];
const rows = () =>
  cases.map((item) => ({
    id: item.id,
    category: item.category,
    weight: 1,
    status: "completed",
    score: 1,
    output: "A",
    cost_usd: 0.02,
    latency_ms: 100,
  }));
const mockOptions = {
  apiKey: "test-only-not-a-real-key",
  model: "gpt-5.6-sol",
  item: cases[0],
  reasoningEffort: "high",
  maxOutputTokens: 4096,
  timeoutMs: 50,
  inputUsdPerMtok: 4,
  outputUsdPerMtok: 20,
};
const response = (body) => new Response(JSON.stringify(body), { status: 200 });

test("duplicate response IDs cannot replace an earlier failure", () => {
  const duplicate = [...rows(), { ...rows()[0], score: 0, status: "error" }];
  assert.throws(() => scoreRun(cases, duplicate), /Duplicate/u);
  assert.throws(() => compareRuns(rows(), duplicate), /Duplicate/u);
  assert.throws(() => gradeRows(cases, duplicate), /Duplicate/u);
});

for (const value of [
  null,
  undefined,
  "",
  "1",
  false,
  true,
  [],
  {},
  Number.NaN,
  Infinity,
  -0.1,
  1.1,
]) {
  test(`strict score rejects ${String(value)} (${typeof value})`, () => {
    const bad = rows();
    bad[0].score = value;
    assert.throws(() => scoreRun(cases, bad), /score/u);
    assert.throws(() => compareRuns(rows(), bad), /score/u);
    assert.throws(
      () => parseJudgeResult(JSON.stringify({ score: value, rationale: "test" })),
      /score/u,
    );
  });
}

test("zero is a valid score and an explicit zero cost is not missing", () => {
  const input = rows().map((row) => ({ ...row, score: 0, cost_usd: 0 }));
  const report = scoreRun(cases, input);
  assert.equal(report.overall_score, 0);
  assert.equal(report.operational.total_cost_usd, 0);
  assert.equal(compareRuns(input, input).relative_quality, null);
});

test("missing or partial costs stay null with coverage and suppress ratios", () => {
  for (const costs of [
    [null, null],
    [0.01, undefined],
  ]) {
    const input = rows().map((row, i) => ({ ...row, cost_usd: costs[i] }));
    const report = scoreRun(cases, input);
    assert.equal(report.operational.total_cost_usd, null);
    assert.equal(report.operational.completeness.cost_usd.complete, false);
    assert.equal(compareRuns(rows(), input).cost_ratio, null);
  }
});

test("partial latency does not become a falsely fast full-run mean", () => {
  const input = rows();
  input[0].latency_ms = null;
  const result = compareRuns(rows(), input);
  assert.equal(result.latency_ratio, null);
  assert.equal(result.candidate.operational.p95_latency_ms, null);
});

for (const field of ["cost_usd", "latency_ms", "input_tokens", "output_tokens"]) {
  test(`rejects invalid ${field}`, () => {
    for (const value of [-1, "0", false, Infinity]) {
      const input = rows();
      input[0][field] = value;
      assert.throws(() => scoreRun(cases, input), new RegExp(field, "u"));
    }
  });
}

test("case and response weights cannot be null, negative, zero, or coerced strings", () => {
  for (const weight of [null, 0, -1, "1", false, Infinity]) {
    assert.throws(() => validateCases([{ ...cases[0], weight }]), /weight/u);
    assert.throws(() => summarizeRows([{ ...rows()[0], weight }]), /weight/u);
  }
});

test("empty suites and runs, unknown responses, and absent aggregate responses are rejected", () => {
  assert.throws(() => validateCases([]), /Empty/u);
  assert.throws(() => compareRuns([], []), /nonempty/u);
  assert.throws(() => scoreRun(cases, rows().slice(0, 1)), /Missing response/u);
  assert.throws(() => gradeRows(cases, [{ id: "unknown" }]), /Unknown response/u);
});

test("all unsuccessful response statuses score zero even with a convincing output", () => {
  for (const status of ["error", "timeout", "failed", "incomplete", "cancelled"]) {
    const raw = rows();
    raw[0].status = status;
    const graded = gradeRows(cases, raw);
    assert.equal(graded[0].score, 0);
    assert.throws(() => scoreRun(cases, raw), /Failed request/u);
  }
  const graded = gradeRows(cases, []);
  assert.equal(graded.length, cases.length);
  assert.ok(graded.every((row) => row.status === "missing" && row.score === 0));
});

test("semantic answers and number mentions need review, not substring credit", () => {
  const item = { grader: { type: "exact", answer: "48" } };
  assert.equal(gradeDeterministic(item, "148").score, 0);
  assert.equal(gradeDeterministic(item, "48 is wrong; the answer is 50."), null);
  assert.equal(gradeDeterministic(item, "48").score, 1);
  assert.equal(
    gradeDeterministic({ grader: { type: "exact_semantic", answer: "Canberra" } }, "Canberra"),
    null,
  );
});

test("fruit constraints neither discard blank lines nor reward arbitrary lowercase words", () => {
  const item = {
    grader: {
      type: "constraints",
      criteria: ["exactly three lines", "lowercase only", "one fruit per line", "no extra text"],
    },
  };
  assert.equal(gradeDeterministic(item, "apple\nbanana\npear").score, 1);
  assert.equal(gradeDeterministic(item, "apple\n\nbanana\npear").score, 0);
  assert.equal(gradeDeterministic(item, "table\nchair\nspoon"), null);
});

test("matching IDs cannot hide a category, weight, or content change", () => {
  for (const change of [{ category: "factuality" }, { weight: 2 }]) {
    const input = rows();
    input[0] = { ...input[0], ...change };
    assert.throws(() => compareRuns(rows(), input), /mismatch/u);
  }
  const reference = rows().map((row) => ({ ...row, suite_sha256: digest("v1") }));
  const candidate = rows().map((row) => ({ ...row, suite_sha256: digest("v2") }));
  assert.throws(() => compareRuns(reference, candidate), /suite_sha256/u);
  assert.throws(() => gradeRows(cases, reference), /Suite content/u);
  assert.equal(compareRuns(rows(), rows()).replacement_eligible, false);
  assert.equal(compareRuns(rows(), rows()).provenance_complete, false);
});

test("weighted scoring and floating-point deltas use numerical tolerances", () => {
  const reference = rows();
  reference[1].latency_ms = 200;
  const candidate = rows();
  candidate[0].score = 0.9;
  candidate[0].latency_ms = 80;
  candidate[1].latency_ms = 120;
  candidate.forEach((row) => {
    row.cost_usd = 0.01;
  });
  const result = compareRuns(reference, candidate);
  assert.ok(Math.abs(result.relative_quality - 0.95) < 1e-12);
  assert.equal(result.cost_ratio, 0.5);
  assert.equal(result.latency_ratio, 2 / 3);
  assert.ok(Math.abs(result.category_delta.coding + 0.1) < 1e-12);
  assert.equal(
    summarizeRows([{ ...reference[0], weight: 3, score: 0 }, reference[1]]).overall_score,
    0.25,
  );
});

test("blind judge includes reference answer without provider or model metadata", () => {
  const input = JSON.parse(
    buildBlindJudgeInput(
      { ...cases[0], provider: "secret-provider", model: "secret-model" },
      "answer",
    ),
  );
  assert.equal(input.reference_answer, "A");
  assert.equal("model" in input, false);
  assert.equal("provider" in input, false);
  assert.throws(() => parseJudgeResult('{"score":1,"rationale":{}}'), /rationale/u);
});

test("provider usage missing or invalid never becomes zero-dollar inference", () => {
  assert.equal(estimateCostUsd({}, 4, 20), null);
  assert.equal(estimateCostUsd({ input_tokens: null, output_tokens: 10 }, 4, 20), null);
  assert.equal(estimateCostUsd({ input_tokens: "1", output_tokens: 1 }, 4, 20), null);
  assert.equal(estimateCostUsd({ input_tokens: 1, output_tokens: 1 }, -1, 20), null);
  assert.equal(estimateCostUsd({ input_tokens: 1000, output_tokens: 500 }, 4, 20), 0.014);
});

test("mock transport is non-stored, disallows redirects and records output/usage", async () => {
  let request;
  const row = await runOpenAiCase({
    ...mockOptions,
    fetcher: async (url, init) => {
      request = { url, ...init, body: JSON.parse(init.body) };
      return response({
        id: "test",
        status: "completed",
        output_text: "A",
        usage: { input_tokens: 100, output_tokens: 25 },
      });
    },
  });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.store, false);
  assert.equal(request.redirect, "error");
  assert.equal(row.status, "completed");
  assert.equal(row.cost_usd, 0.0009);
});

test("incomplete responses stay failed and missing provider status is not completed", async () => {
  for (const status of ["incomplete", "failed", undefined]) {
    const row = await runOpenAiCase({
      ...mockOptions,
      fetcher: async () => response({ status, output_text: "A" }),
    });
    assert.notEqual(row.status, "completed");
    assert.equal(row.score, 0);
  }
});

test("deadline also covers a fetch or body parser that ignores AbortSignal", async () => {
  for (const fetcher of [
    async () => new Promise(() => {}),
    async () => ({ ok: true, json: async () => new Promise(() => {}) }),
  ]) {
    const row = await runOpenAiCase({ ...mockOptions, timeoutMs: 5, fetcher });
    assert.equal(row.status, "timeout");
    assert.equal(row.cost_usd, null);
  }
});

test("HTTP and exception diagnostics do not echo secrets or private provider bodies", async () => {
  for (const fetcher of [
    async () => new Response("private-secret", { status: 401 }),
    async () => {
      throw new Error("private-secret");
    },
  ]) {
    const row = await runOpenAiCase({ ...mockOptions, fetcher });
    assert.equal(row.status, "error");
    assert.ok(!JSON.stringify(row).includes("private-secret"));
  }
});

test("legitimate refusals remain gradable and all output text chunks are collected", () => {
  assert.equal(
    extractOutputText({
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "Cannot disclose private data." }],
        },
      ],
    }),
    "Cannot disclose private data.",
  );
  assert.equal(
    extractOutputText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "A" },
            { type: "output_text", text: "B" },
          ],
        },
      ],
    }),
    "AB",
  );
});

test("judge failures cannot manufacture fully graded results", async () => {
  await assert.rejects(
    judgeCase({
      ...mockOptions,
      output: "answer",
      timeoutMs: 5,
      fetcher: async () => new Promise(() => {}),
    }),
    /unsuccessful: timeout/u,
  );
  await assert.rejects(
    judgeCase({
      ...mockOptions,
      output: "answer",
      fetcher: async () =>
        response({ status: "completed", output_text: '{"score":null,"rationale":"bad"}' }),
    }),
    /score/u,
  );
});

test("complete mock pipeline grades rubric and retains category and scoring provenance", async () => {
  const graded = await judgeRows(cases, rows(), {
    ...mockOptions,
    fetcher: async () =>
      response({
        status: "completed",
        output_text: '{"score":0.75,"rationale":"Partial credit"}',
        usage: { input_tokens: 100, output_tokens: 25 },
      }),
  });
  assert.equal(graded[0].score, 1);
  assert.equal(graded[1].score, 0.75);
  assert.equal(scoreRun(cases, graded).overall_score, 0.875);
  assert.equal(graded[0].scoring_sha256, graded[1].scoring_sha256);
  assert.equal(graded[1].judge_cost_usd, 0.0009);
});

test("CLI execution is opt-in and bounded; malformed options cannot enable spending", () => {
  assert.equal(parseArgs([], ["execute"]).has("execute"), false);
  assert.throws(() => parseArgs(["--execute=false"], ["execute"]), /without a value/u);
  assert.throws(() => parseArgs(["--cases"], ["cases"]), /requires/u);
  assert.throws(() => executionOptions(new Map([["execute", true]]), 30), /max-requests/u);
  assert.throws(
    () =>
      executionOptions(
        new Map([
          ["execute", true],
          ["max-requests", "29"],
        ]),
        30,
      ),
    /max-requests/u,
  );
  assert.equal(
    executionOptions(
      new Map([
        ["execute", true],
        ["max-requests", "30"],
      ]),
      30,
    ).maxOutputTokens,
    4096,
  );
});

test("writing artifacts refuses to overwrite existing evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kova-eval-test-"));
  try {
    const file = path.join(dir, "rows.jsonl");
    await writeJsonl(file, rows());
    const initial = await readFile(file, "utf8");
    await assert.rejects(writeJsonl(file, []), /EEXIST/u);
    assert.equal(await readFile(file, "utf8"), initial);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
