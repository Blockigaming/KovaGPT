import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readJsonl = (path) =>
  readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));

test("smoke categories use the replacement-gate identifier", () => {
  const cases = readJsonl("model/evals/kovaeval-v0.1.jsonl");
  const gate = JSON.parse(readFileSync("model/evals/kova-replacement-gate.v1.json", "utf8"));
  const gateCategories = new Set(gate.categories.map(({ id }) => id));
  const kovaCases = cases.filter(({ id }) => id.startsWith("kova-"));

  assert.equal(kovaCases.length, 3);
  assert.ok(kovaCases.every(({ category }) => category === "kova_product_behavior"));
  assert.ok(kovaCases.every(({ category }) => gateCategories.has(category)));
});

test("example run manifest contains every replacement-gate reproducibility field", () => {
  const manifest = JSON.parse(readFileSync("model/evals/run-manifest.example.json", "utf8"));
  const gate = JSON.parse(readFileSync("model/evals/kova-replacement-gate.v1.json", "utf8"));

  for (const field of gate.requiredRunMetadata) {
    assert.equal(typeof manifest[field], "string", `missing ${field}`);
    assert.ok(manifest[field].trim(), `blank ${field}`);
  }
});

test("frozen long-context smoke cases contain substantial retrieval context", () => {
  const cases = readJsonl("model/evals/kovaeval-v0.1.jsonl");
  const longCases = cases.filter(({ category }) => category === "long_context");

  assert.equal(longCases.length, 2);
  for (const item of longCases) {
    assert.ok(item.prompt.length >= 32_768, `${item.id} is not long context`);
  }
  assert.ok(longCases[0].prompt.indexOf("Plus accounts may create 20 projects") >= 24_000);
  assert.ok(longCases[1].prompt.indexOf("09:00 deploy A begins") >= 24_000);
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
