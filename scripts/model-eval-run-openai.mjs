import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const API_URL = 'https://api.openai.com/v1/responses';

export function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('');
}

export function estimateCostUsd(usage, inputUsdPerMtok, outputUsdPerMtok) {
  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);
  if (!Number.isFinite(inputUsdPerMtok) || !Number.isFinite(outputUsdPerMtok)) return null;
  return (inputTokens * inputUsdPerMtok + outputTokens * outputUsdPerMtok) / 1_000_000;
}

export async function runOpenAiCase({ apiKey, item, model, reasoningEffort, maxOutputTokens, timeoutMs, inputUsdPerMtok, outputUsdPerMtok, fetcher = fetch }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for a live KovaEval run');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const upstream = await fetcher(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: item.prompt,
        max_output_tokens: maxOutputTokens,
        reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
        store: false,
      }),
      signal: controller.signal,
    });
    const body = await upstream.json();
    const latencyMs = Math.round(performance.now() - started);
    if (!upstream.ok) {
      return { id: item.id, model, status: 'error', score: 0, latency_ms: latencyMs, error: body?.error?.message || `HTTP ${upstream.status}` };
    }
    const usage = body?.usage || {};
    return {
      id: item.id,
      model,
      provider_response_id: body?.id || null,
      status: body?.status || 'completed',
      output: extractOutputText(body),
      latency_ms: latencyMs,
      input_tokens: Number(usage.input_tokens || 0),
      output_tokens: Number(usage.output_tokens || 0),
      cost_usd: estimateCostUsd(usage, inputUsdPerMtok, outputUsdPerMtok),
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    return { id: item.id, model, status: error?.name === 'AbortError' ? 'timeout' : 'error', score: 0, latency_ms: latencyMs, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
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
  const model = String(args.get('model') || 'gpt-5.6-sol');
  const reasoningEffort = String(args.get('reasoning') || 'high');
  const maxOutputTokens = Number(args.get('max-output-tokens') || 4096);
  const timeoutMs = Number(args.get('timeout-ms') || 120000);
  const outPath = path.resolve(String(args.get('out') || `artifacts/model-eval/raw-${model}-${Date.now()}.jsonl`));
  const inputUsdPerMtok = Number(process.env.KOVA_EVAL_INPUT_USD_PER_MTOK);
  const outputUsdPerMtok = Number(process.env.KOVA_EVAL_OUTPUT_USD_PER_MTOK);
  const cases = await readJsonl(casesPath);
  const rows = [];
  for (const item of cases) {
    const row = await runOpenAiCase({
      apiKey: process.env.OPENAI_API_KEY,
      item,
      model,
      reasoningEffort,
      maxOutputTokens,
      timeoutMs,
      inputUsdPerMtok,
      outputUsdPerMtok,
    });
    rows.push(row);
    process.stdout.write(`${item.id}: ${row.status} ${row.latency_ms}ms\n`);
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  process.stdout.write(`Wrote ${rows.length} raw responses to ${outPath}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  await main();
}
