import {
  DEFAULT_CASES,
  digest,
  indexRows,
  isMain,
  parseArgs,
  readJsonl,
  summarizeRows,
  validateCases,
  writeJson,
} from "./model-eval-contract.mjs";

export function scoreRun(cases, responses) {
  const caseById = validateCases(cases);
  const byId = indexRows(responses);
  if ([...byId.keys()].some((id) => !caseById.has(id))) throw new Error("Unknown response id");
  const rows = cases.map((item) => {
    const response = byId.get(item.id);
    if (!response) throw new Error(`Missing response for ${item.id}`);
    if (response.category !== undefined && response.category !== item.category) {
      throw new Error(`Category mismatch for ${item.id}`);
    }
    if (response.weight !== undefined && response.weight !== (item.weight ?? 1)) {
      throw new Error(`Weight mismatch for ${item.id}`);
    }
    if (response.case_sha256 !== undefined && response.case_sha256 !== digest(item)) {
      throw new Error(`Case content mismatch for ${item.id}`);
    }
    return { ...response, category: item.category, weight: item.weight ?? 1 };
  });
  return { schema_version: 2, suite_sha256: digest(cases), ...summarizeRows(rows), rows };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["cases", "responses", "out"]);
  const cases = await readJsonl(args.get("cases") ?? DEFAULT_CASES);
  validateCases(cases);
  if (!args.has("responses")) {
    console.log(
      JSON.stringify(
        {
          valid: true,
          cases: cases.length,
          suite_sha256: digest(cases),
          categories: [...new Set(cases.map((item) => item.category))].sort(),
          replacement_eligible: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  const report = scoreRun(cases, await readJsonl(args.get("responses")));
  await writeJson(args.get("out") ?? "artifacts/model-eval/report.json", report);
  console.log(JSON.stringify(report, null, 2));
}

if (isMain(import.meta.url)) await main();
