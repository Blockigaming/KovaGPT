import fs from 'node:fs/promises';
import path from 'node:path';

const readJsonl = async (file) => (await fs.readFile(file, 'utf8')).split(/\r?\n/u).filter(Boolean).map(JSON.parse);

export function buildBlindJudgeInput(item, output) {
  return JSON.stringify({
    task: item.prompt,
    rubric: item.grader?.criteria || [],
    candidate_answer: String(output || ''),
  });
}

export function parseJudgeResult(text) {
  const parsed = JSON.parse(String(text || '').trim());
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('Judge score must be between 0 and 1');
  return { score, rationale: String(parsed.rationale || '').slice(0, 1000) };
}

async function judge({ apiKey, model, item, output, fetcher = fetch }) {
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'You are a blind evaluator. You do not know which model produced the candidate answer. Score only against the supplied task and rubric. Return JSON only: {"score": number from 0 to 1, "rationale": short string}. Do not reward verbosity or infer model identity.' }] },
        { role: 'user', content: [{ type: 'input_text', text: buildBlindJudgeInput(item, output) }] },
      ],
      max_output_tokens: 300,
    }),
  });
  if (!response.ok) throw new Error(`Judge HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body = await response.json();
  const text = body.output_text || (body.output || []).flatMap((x) => x.content || []).find((x) => x.type === 'output_text')?.text || '';
  return parseJudgeResult(text);
}

async function main() {
  const args = new Map(process.argv.slice(2).map((arg) => { const [k, ...r] = arg.split('='); return [k.replace(/^--/u, ''), r.join('=') || true]; }));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required; never commit it.');
  const judgeModel = String(args.get('model') || process.env.KOVA_EVAL_JUDGE_MODEL || 'gpt-5.6-sol');
  const cases = await readJsonl(path.resolve(String(args.get('cases') || 'model/evals/cases.jsonl')));
  const gradesPath = path.resolve(String(args.get('grades') || 'artifacts/model-eval/deterministic-grades.jsonl'));
  const rows = await readJsonl(gradesPath);
  const caseById = new Map(cases.map((x) => [x.id, x]));
  const out = [];
  for (const row of rows) {
    if (row.score !== null) { out.push(row); continue; }
    const item = caseById.get(row.id);
    if (!item) throw new Error(`Missing eval case ${row.id}`);
    const result = await judge({ apiKey, model: judgeModel, item, output: row.output });
    out.push({ ...row, score: result.score, grade_method: 'blind-rubric-judge', judge_model: judgeModel, judge_rationale: result.rationale });
  }
  const outPath = path.resolve(String(args.get('out') || 'artifacts/model-eval/graded.jsonl'));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${out.map(JSON.stringify).join('\n')}\n`);
  process.stdout.write(`Wrote ${out.length} fully graded rows to ${outPath}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
