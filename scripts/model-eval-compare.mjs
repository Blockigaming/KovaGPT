import fs from 'node:fs/promises';
import path from 'node:path';

const readJsonl = async (file) => (await fs.readFile(file, 'utf8')).split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const mean = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;

function summarize(rows) {
  const categories = {};
  for (const row of rows) {
    if (!Number.isFinite(Number(row.score))) throw new Error(`Missing score for ${row.id}`);
    (categories[row.category] ||= []).push(Number(row.score));
  }
  const category_scores = Object.fromEntries(Object.entries(categories).sort().map(([k,v]) => [k, mean(v)]));
  const costs = rows.map((x)=>Number(x.cost_usd)).filter(Number.isFinite);
  const latencies = rows.map((x)=>Number(x.latency_ms)).filter(Number.isFinite);
  return {
    cases: rows.length,
    overall_score: mean(rows.map((x)=>Number(x.score))),
    category_scores,
    total_cost_usd: costs.reduce((a,b)=>a+b,0),
    mean_latency_ms: mean(latencies),
  };
}

export function compareRuns(referenceRows, candidateRows) {
  const refById = new Map(referenceRows.map((x)=>[x.id,x]));
  const candById = new Map(candidateRows.map((x)=>[x.id,x]));
  const ids = [...refById.keys()].sort();
  if (ids.length !== candById.size || ids.some((id)=>!candById.has(id))) throw new Error('Reference and candidate case IDs must match exactly');
  const reference = summarize(referenceRows);
  const candidate = summarize(candidateRows);
  const category_delta = Object.fromEntries(Object.keys(reference.category_scores).sort().map((k)=>[k,(candidate.category_scores[k] ?? 0)-reference.category_scores[k]]));
  return {
    schema_version: 1,
    reference,
    candidate,
    relative_quality: reference.overall_score ? candidate.overall_score/reference.overall_score : null,
    cost_ratio: reference.total_cost_usd ? candidate.total_cost_usd/reference.total_cost_usd : null,
    latency_ratio: reference.mean_latency_ms ? candidate.mean_latency_ms/reference.mean_latency_ms : null,
    category_delta,
  };
}

async function main() {
  const args = new Map(process.argv.slice(2).map((arg)=>{ const [k,...r]=arg.split('='); return [k.replace(/^--/u,''),r.join('=')||true]; }));
  const referencePath = args.get('reference');
  const candidatePath = args.get('candidate');
  if (!referencePath || !candidatePath) throw new Error('Use --reference=<graded.jsonl> --candidate=<graded.jsonl>');
  const report = compareRuns(await readJsonl(path.resolve(String(referencePath))), await readJsonl(path.resolve(String(candidatePath))));
  const outPath = path.resolve(String(args.get('out') || 'artifacts/model-eval/comparison.json'));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report,null,2)}\n`);
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
