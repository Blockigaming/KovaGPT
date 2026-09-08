import fs from 'node:fs/promises';
import path from 'node:path';

export function normalize(text) {
  return String(text || '').trim().toLowerCase().replace(/[$,%]/gu, '').replace(/\s+/gu, ' ');
}

export function gradeDeterministic(item, output) {
  const grader = item?.grader || {};
  if (grader.type === 'exact') {
    const expected = normalize(grader.answer);
    const actual = normalize(output);
    return { score: actual.includes(expected) ? 1 : 0, method: 'deterministic-exact' };
  }
  if (grader.type === 'exact_semantic') {
    const expectedParts = String(grader.answer || '').split(';').map(normalize).filter(Boolean);
    const actual = normalize(output);
    return { score: expectedParts.length && expectedParts.every((part) => actual.includes(part)) ? 1 : 0, method: 'deterministic-semantic' };
  }
  if (grader.type === 'constraints') {
    const text = String(output || '');
    const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
    const criteria = grader.criteria || [];
    const checks = criteria.map((criterion) => {
      if (criterion === 'exactly three lines') return lines.length === 3;
      if (criterion === 'lowercase only') return lines.every((line) => line === line.toLowerCase());
      if (criterion === 'one fruit per line') return lines.every((line) => /^[a-z]+$/u.test(line.trim()));
      if (criterion === 'no extra text') return lines.length === 3 && lines.every((line) => /^[a-z]+$/u.test(line.trim()));
      return false;
    });
    return { score: checks.length ? checks.filter(Boolean).length / checks.length : 0, method: 'deterministic-constraints' };
  }
  return null;
}

async function readJsonl(file) {
  return (await fs.readFile(file, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function main() {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=');
    return [key.replace(/^--/u, ''), rest.join('=') || true];
  }));
  const casesPath = path.resolve(String(args.get('cases') || 'model/evals/cases.jsonl'));
  const responsesPath = path.resolve(String(args.get('responses') || 'artifacts/model-eval/raw.jsonl'));
  const outPath = path.resolve(String(args.get('out') || 'artifacts/model-eval/deterministic-grades.jsonl'));
  const cases = await readJsonl(casesPath);
  const responses = new Map((await readJsonl(responsesPath)).map((row) => [row.id, row]));
  const rows = [];
  for (const item of cases) {
    const response = responses.get(item.id);
    if (!response) continue;
    if (response.status === 'error' || response.status === 'timeout') {
      rows.push({ ...response, score: 0, grade_method: 'request-failure' });
      continue;
    }
    const grade = gradeDeterministic(item, response.output);
    rows.push({ ...response, score: grade?.score ?? null, grade_method: grade?.method ?? 'requires-blind-rubric-judge' });
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const pending = rows.filter((row) => row.score === null).length;
  process.stdout.write(`Graded ${rows.length - pending}/${rows.length} deterministically; ${pending} require blind rubric judging.\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
