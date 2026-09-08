import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.join('=') || true];
}));
const casesPath = path.resolve(String(args.get('cases') || 'model/evals/cases.jsonl'));
const responsesPath = args.get('responses') ? path.resolve(String(args.get('responses'))) : null;
const outPath = path.resolve(String(args.get('out') || 'artifacts/model-eval-report.json'));

const parseJsonl = async (file) => (await fs.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((line, i) => {
  try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL ${file}:${i + 1}: ${error.message}`); }
});

const cases = await parseJsonl(casesPath);
const ids = new Set();
for (const item of cases) {
  if (!item.id || !item.category || !item.prompt || !item.grader) throw new Error(`Invalid eval case: ${JSON.stringify(item)}`);
  if (ids.has(item.id)) throw new Error(`Duplicate eval id: ${item.id}`);
  ids.add(item.id);
}

if (!responsesPath) {
  console.log(JSON.stringify({ valid: true, cases: cases.length, categories: [...new Set(cases.map((x) => x.category))].sort() }, null, 2));
  process.exit(0);
}

const responses = await parseJsonl(responsesPath);
const byId = new Map(responses.map((x) => [x.id, x]));
const rows = cases.map((item) => {
  const response = byId.get(item.id);
  const score = Number(response?.score);
  if (!response || !Number.isFinite(score) || score < 0 || score > 1) throw new Error(`Missing/invalid 0..1 score for ${item.id}`);
  return { id: item.id, category: item.category, weight: Number(item.weight || 1), score, latency_ms: response.latency_ms ?? null, input_tokens: response.input_tokens ?? null, output_tokens: response.output_tokens ?? null, cost_usd: response.cost_usd ?? null };
});

const aggregate = (items) => {
  const totalWeight = items.reduce((sum, x) => sum + x.weight, 0);
  return items.reduce((sum, x) => sum + x.score * x.weight, 0) / totalWeight;
};
const categories = Object.fromEntries([...new Set(rows.map((x) => x.category))].sort().map((category) => [category, aggregate(rows.filter((x) => x.category === category))]));
const numeric = (key) => rows.map((x) => x[key]).filter((x) => Number.isFinite(x));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const report = {
  schema_version: 1,
  cases: rows.length,
  overall_score: aggregate(rows),
  categories,
  operational: {
    total_cost_usd: sum(numeric('cost_usd')),
    total_input_tokens: sum(numeric('input_tokens')),
    total_output_tokens: sum(numeric('output_tokens')),
    mean_latency_ms: numeric('latency_ms').length ? sum(numeric('latency_ms')) / numeric('latency_ms').length : null,
  },
  rows,
};
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
