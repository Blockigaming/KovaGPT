import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_CASES = "model/evals/kovaeval-v0.1.jsonl";
export const FAILURE_STATUSES = new Set([
  "error",
  "timeout",
  "failed",
  "cancelled",
  "incomplete",
  "missing",
]);
export const isMain = (url) =>
  Boolean(process.argv[1]) && url === pathToFileURL(path.resolve(process.argv[1])).href;
export const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
export const validScore = (value) => finiteNumber(value) && value >= 0 && value <= 1;
export const positiveWeight = (value) => finiteNumber(value) && value > 0;
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

export function digest(value) {
  const stable = (x) => {
    if (Array.isArray(x)) return x.map(stable);
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(
        Object.keys(x)
          .sort()
          .map((key) => [key, stable(x[key])]),
      );
    }
    return x;
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

export function parseArgs(argv, allowed) {
  const result = new Map();
  for (const arg of argv) {
    const match = /^--([a-z][a-z-]*)(?:=(.+))?$/u.exec(arg);
    if (!match || !allowed.includes(match[1]) || result.has(match[1])) {
      throw new Error("Unknown, repeated, or malformed argument; use --name=value");
    }
    if (match[1] !== "execute" && match[2] === undefined) {
      throw new Error(`--${match[1]} requires a value`);
    }
    if (match[1] === "execute" && match[2] !== undefined) {
      throw new Error("Use --execute without a value");
    }
    result.set(match[1], match[2] ?? true);
  }
  return result;
}

export async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Do not include potentially private source text in diagnostics.
      throw new Error(`Invalid JSONL at line ${index + 1}`);
    }
  }
  return rows;
}

export function indexRows(rows, label = "response") {
  if (!Array.isArray(rows)) throw new Error(`${label} rows must be an array`);
  const result = new Map();
  for (const row of rows) {
    if (!row || !nonempty(row.id)) throw new Error(`Invalid ${label} id`);
    if (result.has(row.id)) throw new Error(`Duplicate ${label} id: ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}

export function validateCases(cases) {
  const byId = indexRows(cases, "eval");
  if (!byId.size) throw new Error("Empty evaluation suite");
  for (const item of cases) {
    if (!nonempty(item.category) || !nonempty(item.prompt) || !item.grader) {
      throw new Error(`Invalid eval case: ${item.id}`);
    }
    if (!positiveWeight(item.weight === undefined ? 1 : item.weight))
      throw new Error(`Invalid weight for ${item.id}`);
    const { type, answer, criteria } = item.grader;
    if (["exact", "exact_semantic"].includes(type)) {
      if (!nonempty(answer)) throw new Error(`Missing reference answer for ${item.id}`);
    } else if (["rubric", "constraints"].includes(type)) {
      if (!Array.isArray(criteria) || !criteria.length || !criteria.every(nonempty)) {
        throw new Error(`Missing rubric criteria for ${item.id}`);
      }
    } else {
      throw new Error(`Unsupported grader for ${item.id}`);
    }
  }
  return byId;
}

export function metricSummary(rows, key, integer = false) {
  const values = [];
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (!finiteNumber(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
      throw new Error(`Invalid ${key} for ${row.id}`);
    }
    values.push(value);
  }
  const observedSum = values.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(observedSum)) throw new Error(`Overflow in ${key}`);
  const complete = rows.length > 0 && values.length === rows.length;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => (complete ? sorted[Math.ceil(sorted.length * p) - 1] : null);
  return {
    complete,
    observed_count: values.length,
    expected_count: rows.length,
    observed_sum: observedSum,
    total: complete ? observedSum : null,
    mean: complete ? observedSum / values.length : null,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

export function summarizeRows(rows) {
  if (!indexRows(rows).size) throw new Error("Empty evaluation run");
  for (const row of rows) {
    if (!nonempty(row.category)) throw new Error(`Missing category for ${row.id}`);
    if (!validScore(row.score)) throw new Error(`Missing/invalid 0..1 score for ${row.id}`);
    if (!positiveWeight(row.weight === undefined ? 1 : row.weight))
      throw new Error(`Invalid weight for ${row.id}`);
    if (
      row.status !== undefined &&
      row.status !== "completed" &&
      !FAILURE_STATUSES.has(row.status)
    ) {
      throw new Error(`Unknown response status for ${row.id}`);
    }
    if (FAILURE_STATUSES.has(row.status) && row.score !== 0) {
      throw new Error(`Failed request cannot have a positive score: ${row.id}`);
    }
  }
  const weighted = (items) => {
    const total = items.reduce((sum, row) => sum + (row.weight ?? 1), 0);
    if (!Number.isFinite(total)) throw new Error("Evaluation weight overflow");
    return items.reduce((sum, row) => sum + row.score * ((row.weight ?? 1) / total), 0);
  };
  const categoryScores = Object.fromEntries(
    [...new Set(rows.map((row) => row.category))]
      .sort()
      .map((category) => [category, weighted(rows.filter((row) => row.category === category))]),
  );
  const cost = metricSummary(rows, "cost_usd");
  const latency = metricSummary(rows, "latency_ms");
  const input = metricSummary(rows, "input_tokens", true);
  const output = metricSummary(rows, "output_tokens", true);
  const judgeCost = metricSummary(rows, "judge_cost_usd");
  return {
    cases: rows.length,
    overall_score: weighted(rows),
    categories: categoryScores,
    score_kind: "case-weighted-smoke-score-not-replacement-gate",
    replacement_eligible: false,
    operational: {
      total_cost_usd: cost.total,
      total_judge_cost_usd: judgeCost.total,
      total_input_tokens: input.total,
      total_output_tokens: output.total,
      mean_latency_ms: latency.mean,
      p50_latency_ms: latency.p50,
      p95_latency_ms: latency.p95,
      completeness: {
        cost_usd: cost,
        judge_cost_usd: judgeCost,
        latency_ms: latency,
        input_tokens: input,
        output_tokens: output,
      },
    },
  };
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export async function writeJsonl(file, rows) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}
