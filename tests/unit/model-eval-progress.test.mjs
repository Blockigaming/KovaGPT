import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { summarizeProgress } from "../../scripts/model-eval-progress.mjs";

const ledger = JSON.parse(await readFile("model/evals/program-progress.json", "utf8"));

test("progress reports verified engineering checkpoints, not model capability", () => {
  const result = summarizeProgress(ledger);
  const verified = ledger.checkpoints.filter((item) => item.status === "verified").length;
  assert.equal(result.percent, verified * 5);
  assert.equal(result.total_checkpoints, 20);
  assert.equal(result.replacement_authorized, false);
  assert.match(result.basis, /not measured model capability/u);
});

test("0 and 100 percent are bookkeeping boundaries, never deployment authorization", () => {
  for (const status of ["pending", "verified"]) {
    const fixture = structuredClone(ledger);
    fixture.checkpoints.forEach((item) => {
      item.status = status;
      item.evidence = status === "verified" ? ["Synthetic test evidence"] : [];
    });
    const result = summarizeProgress(fixture);
    assert.equal(result.percent, status === "verified" ? 100 : 0);
    assert.equal(result.replacement_authorized, false);
  }
});

test("progress rejects unsupported denominator, duplicate IDs and evidence-free completion", () => {
  const short = structuredClone(ledger);
  short.checkpoints.pop();
  assert.throws(() => summarizeProgress(short), /20-checkpoint/u);
  const duplicate = structuredClone(ledger);
  duplicate.checkpoints[1].id = duplicate.checkpoints[0].id;
  assert.throws(() => summarizeProgress(duplicate), /duplicate/u);
  const unsupported = structuredClone(ledger);
  unsupported.checkpoints[0].status = "done";
  assert.throws(() => summarizeProgress(unsupported), /Invalid/u);
  const unverified = structuredClone(ledger);
  unverified.checkpoints[0].status = "verified";
  unverified.checkpoints[0].evidence = [];
  assert.throws(() => summarizeProgress(unverified), /evidence/u);
});
