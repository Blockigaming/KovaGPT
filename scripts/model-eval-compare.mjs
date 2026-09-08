import {
  indexRows, isMain, parseArgs, readJsonl, summarizeRows, writeJson,
} from "./model-eval-contract.mjs";

export function compareRuns(referenceRows, candidateRows) {
  const refById = indexRows(referenceRows, "reference");
  const candById = indexRows(candidateRows, "candidate");
  const ids = [...refById.keys()].sort();
  if (!ids.length || ids.length !== candById.size || ids.some((id) => !candById.has(id))) {
    throw new Error("Reference and candidate case IDs must match exactly and be nonempty");
  }
  let provenanceComplete = true;
  const hashes = ["case_sha256", "suite_sha256", "inference_sha256", "scoring_sha256"];
  for (const id of ids) {
    const reference = refById.get(id);
    const candidate = candById.get(id);
    if (reference.category !== candidate.category || (reference.weight ?? 1) !== (candidate.weight ?? 1)) {
      throw new Error(`Category or weight mismatch for ${id}`);
    }
    for (const key of hashes) {
      const left = reference[key];
      const right = candidate[key];
      if (left === undefined && right === undefined) {
        provenanceComplete = false;
        continue;
      }
      if (typeof left !== "string" || !/^[a-f0-9]{64}$/u.test(left) || left !== right) {
        throw new Error(`Evaluation ${key} mismatch for ${id}`);
      }
    }
  }
  for (const rows of [referenceRows, candidateRows]) {
    for (const key of ["suite_sha256", "inference_sha256", "scoring_sha256", "run_id", "model"]) {
      if (new Set(rows.map((row) => row[key])).size > 1) throw new Error(`Mixed ${key} within a run`);
    }
  }
  const summarize = (rows) => {
    const report = summarizeRows(rows);
    return { ...report, category_scores: report.categories,
      total_cost_usd: report.operational.total_cost_usd,
      mean_latency_ms: report.operational.mean_latency_ms };
  };
  const reference = summarize(referenceRows);
  const candidate = summarize(candidateRows);
  const ratio = (a, b) => a !== null && b !== null && b > 0 ? a / b : null;
  return {
    schema_version: 2, reference, candidate,
    relative_quality: ratio(candidate.overall_score, reference.overall_score),
    cost_ratio: ratio(candidate.total_cost_usd, reference.total_cost_usd),
    latency_ratio: ratio(candidate.mean_latency_ms, reference.mean_latency_ms),
    category_delta: Object.fromEntries(Object.keys(reference.categories).map((category) => [
      category, candidate.categories[category] - reference.categories[category],
    ])),
    provenance_complete: provenanceComplete,
    comparison_scope: provenanceComplete ? "matching-recorded-hashes" : "unverified-legacy-inputs",
    replacement_eligible: false,
    limitations: ["Smoke suite only; no statistical parity or production replacement is established.",
      "Matching recorded hashes are integrity checks, not independent proof of model execution."],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["reference", "candidate", "out"]);
  if (!args.has("reference") || !args.has("candidate")) {
    throw new Error("Use --reference=<graded.jsonl> --candidate=<graded.jsonl>");
  }
  const report = compareRuns(await readJsonl(args.get("reference")), await readJsonl(args.get("candidate")));
  await writeJson(args.get("out") ?? "artifacts/model-eval/comparison.json", report);
  console.log(JSON.stringify(report, null, 2));
}

if (isMain(import.meta.url)) await main();
