import {
  DEFAULT_CASES,
  FAILURE_STATUSES,
  digest,
  indexRows,
  isMain,
  parseArgs,
  readJsonl,
  validateCases,
  writeJsonl,
} from "./model-eval-contract.mjs";

export const SCORING_VERSION = "kova-smoke-grading-v3";
const FRUITS = new Set([
  "apple",
  "apricot",
  "avocado",
  "banana",
  "blackberry",
  "blueberry",
  "cherry",
  "coconut",
  "cranberry",
  "date",
  "fig",
  "grape",
  "grapefruit",
  "guava",
  "kiwi",
  "lemon",
  "lime",
  "lychee",
  "mango",
  "melon",
  "nectarine",
  "orange",
  "papaya",
  "peach",
  "pear",
  "pineapple",
  "plum",
  "pomegranate",
  "raspberry",
  "strawberry",
  "tangerine",
  "watermelon",
]);

// Normalize only a bare decimal/currency value; literal answers are byte-sensitive.
export function normalize(text) {
  const value = String(text ?? "").trim();
  return /^\$-?\d+(?:\.\d+)?$/u.test(value) ? value.slice(1) : value;
}

function decimalKey(value) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const integer = whole.replace(/^0+(?=\d)/u, "");
  const decimal = fraction.replace(/0+$/u, "");
  const sign = negative && (integer !== "0" || decimal) ? "-" : "";
  return `${sign}${integer}${decimal ? `.${decimal}` : ""}`;
}

export function gradeDeterministic(item, output) {
  const grader = item?.grader ?? {};
  if (grader.type === "exact") {
    const expected = grader.answer;
    if (typeof expected !== "string" || !expected.trim()) {
      throw new Error("Exact grader needs a nonempty reference answer");
    }
    if (typeof output !== "string") return { score: 0, method: "deterministic-exact" };
    if (/^-?\d+(?:\.\d+)?$/u.test(expected)) {
      const actual = normalize(output);
      if (/^-?\d+(?:\.\d+)?$/u.test(actual)) {
        return {
          score: decimalKey(actual) === decimalKey(expected) ? 1 : 0,
          method: "deterministic-numeric",
        };
      }
      // A number embedded in an explanation does not prove its conclusion is correct.
      return null;
    }
    return { score: output === expected ? 1 : 0, method: "deterministic-exact" };
  }
  // Natural-language equivalence cannot be established using substring tests.
  if (grader.type === "exact_semantic") return null;
  if (grader.type === "constraints") {
    const supported = [
      "exactly three lines",
      "lowercase only",
      "one fruit per line",
      "no extra text",
    ];
    if (
      !Array.isArray(grader.criteria) ||
      grader.criteria.length !== supported.length ||
      !supported.every((criterion) => grader.criteria.includes(criterion))
    )
      return null;
    const text = String(output ?? "")
      .replace(/\r\n/gu, "\n")
      .replace(/\n$/u, "");
    const lines = text.split("\n");
    if (lines.length !== 3 || !lines.every((line) => /^[a-z]+$/u.test(line))) {
      return { score: 0, method: "deterministic-constraints" };
    }
    // Unfamiliar fruit names need semantic review, not false rejection or automatic acceptance.
    if (!lines.every((line) => FRUITS.has(line))) return null;
    return { score: 1, method: "deterministic-constraints" };
  }
  return null;
}

export function gradeRows(cases, responses) {
  const caseById = validateCases(cases);
  const byId = indexRows(responses);
  for (const id of byId.keys())
    if (!caseById.has(id)) throw new Error(`Unknown response id: ${id}`);
  const suiteHash = digest(cases);
  return cases.map((item) => {
    const response = byId.get(item.id) ?? { id: item.id, status: "missing", output: "" };
    if (response.status !== "completed" && !FAILURE_STATUSES.has(response.status)) {
      throw new Error(`Unknown response status for ${item.id}`);
    }
    if (response.case_sha256 !== undefined && response.case_sha256 !== digest(item)) {
      throw new Error(`Case content mismatch for ${item.id}`);
    }
    if (response.suite_sha256 !== undefined && response.suite_sha256 !== suiteHash) {
      throw new Error(`Suite content mismatch for ${item.id}`);
    }
    const grade = FAILURE_STATUSES.has(response.status)
      ? { score: 0, method: "request-failure" }
      : gradeDeterministic(item, response.output);
    return {
      ...response,
      category: item.category,
      weight: item.weight ?? 1,
      case_sha256: digest(item),
      suite_sha256: suiteHash,
      scoring_sha256: digest(SCORING_VERSION),
      score: grade?.score ?? null,
      grade_method: grade?.method ?? "requires-blind-rubric-judge",
      judge_cost_usd: grade ? 0 : null,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["cases", "responses", "out"]);
  const rows = gradeRows(
    await readJsonl(args.get("cases") ?? DEFAULT_CASES),
    await readJsonl(args.get("responses") ?? "artifacts/model-eval/raw.jsonl"),
  );
  await writeJsonl(args.get("out") ?? "artifacts/model-eval/deterministic-grades.jsonl", rows);
  const pending = rows.filter((row) => row.score === null).length;
  console.log(`Graded ${rows.length - pending}/${rows.length}; ${pending} require rubric review.`);
}

if (isMain(import.meta.url)) await main();
