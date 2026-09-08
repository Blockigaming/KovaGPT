import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CASES,
  digest,
  finiteNumber,
  isMain,
  parseArgs,
  readJsonl,
  validateCases,
  writeJson,
} from "./model-eval-contract.mjs";

const API_URL = "https://api.openai.com/v1/responses";
const tokenCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

export function extractOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string")
        parts.push(content.text);
      if (content?.type === "refusal" && typeof content.refusal === "string")
        parts.push(content.refusal);
    }
  }
  return parts.join("");
}

export function estimateCostUsd(usage, inputUsdPerMtok, outputUsdPerMtok) {
  const input = tokenCount(usage?.input_tokens);
  const output = tokenCount(usage?.output_tokens);
  if (
    input === null ||
    output === null ||
    !finiteNumber(inputUsdPerMtok) ||
    inputUsdPerMtok < 0 ||
    !finiteNumber(outputUsdPerMtok) ||
    outputUsdPerMtok < 0
  )
    return null;
  const cost = (input * inputUsdPerMtok + output * outputUsdPerMtok) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

export async function runOpenAiCase({
  apiKey,
  item,
  model,
  reasoningEffort,
  maxOutputTokens,
  timeoutMs,
  inputUsdPerMtok,
  outputUsdPerMtok,
  fetcher = fetch,
}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("OPENAI_API_KEY is required");
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 16 ||
    maxOutputTokens > 128000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  ) {
    throw new Error("Invalid output-token or timeout limit");
  }
  const controller = new AbortController();
  const started = performance.now();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("deadline"));
    }, timeoutMs);
  });
  const base = {
    id: item.id,
    model,
    category: item.category,
    weight: item.weight ?? 1,
    case_sha256: digest(item),
    output: "",
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    cost_kind: "uncached-token-estimate",
  };
  try {
    const result = await Promise.race([
      deadline,
      (async () => {
        const upstream = await fetcher(API_URL, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            input: item.input ?? item.prompt,
            max_output_tokens: maxOutputTokens,
            reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
            store: false,
          }),
          signal: controller.signal,
        });
        if (!upstream.ok)
          return { ...base, status: "error", score: 0, error_code: `HTTP_${upstream.status}` };
        const body = await upstream.json();
        const output = extractOutputText(body);
        const status = ["completed", "failed", "cancelled", "incomplete"].includes(body?.status)
          ? body.status
          : "error";
        const finalStatus = status === "completed" && !output.trim() ? "error" : status;
        return {
          ...base,
          status: finalStatus,
          score: finalStatus === "completed" ? null : 0,
          provider_response_id: typeof body?.id === "string" ? body.id : null,
          returned_model: typeof body?.model === "string" ? body.model : null,
          output,
          input_tokens: tokenCount(body?.usage?.input_tokens),
          output_tokens: tokenCount(body?.usage?.output_tokens),
          cost_usd: estimateCostUsd(body?.usage, inputUsdPerMtok, outputUsdPerMtok),
        };
      })(),
    ]);
    return { ...result, latency_ms: Math.round(performance.now() - started) };
  } catch {
    return {
      ...base,
      status: controller.signal.aborted ? "timeout" : "error",
      score: 0,
      latency_ms: Math.round(performance.now() - started),
      error_code: controller.signal.aborted ? "DEADLINE_EXCEEDED" : "PROVIDER_REQUEST_FAILED",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function executionOptions(args, count) {
  const options = {
    maxOutputTokens: Number(args.get("max-output-tokens") ?? 4096),
    timeoutMs: Number(args.get("timeout-ms") ?? 120000),
  };
  if (
    !Number.isSafeInteger(options.maxOutputTokens) ||
    options.maxOutputTokens < 16 ||
    options.maxOutputTokens > 128000 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 600000
  )
    throw new Error("Invalid execution limits");
  if (args.has("execute")) {
    const cap = Number(args.get("max-requests"));
    if (!Number.isSafeInteger(cap) || cap < count || cap < 1 || cap > 1000) {
      throw new Error(
        "Live execution requires --max-requests covering the selected cases (1..1000)",
      );
    }
  }
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), [
    "cases",
    "model",
    "reasoning",
    "max-output-tokens",
    "timeout-ms",
    "out",
    "execute",
    "max-requests",
  ]);
  const cases = await readJsonl(args.get("cases") ?? DEFAULT_CASES);
  validateCases(cases);
  const options = executionOptions(args, cases.length);
  const model = args.get("model") ?? "gpt-5.6-sol";
  const reasoningEffort = args.get("reasoning") ?? "high";
  const inference = {
    protocol: "responses-text-smoke-v2",
    reasoning: reasoningEffort,
    max_output_tokens: options.maxOutputTokens,
    timeout_ms: options.timeoutMs,
    tools: "none",
    store: false,
  };
  const manifest = {
    schema_version: 2,
    run_id: randomUUID(),
    started_at: new Date().toISOString(),
    model,
    suite_sha256: digest(cases),
    inference_sha256: digest(inference),
    inference,
    cases: cases.length,
    live: args.has("execute"),
    replacement_eligible: false,
  };
  if (!args.has("execute")) {
    console.log(
      JSON.stringify({ ...manifest, note: "Dry run: no API calls or spending." }, null, 2),
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is required");
  const rate = (value) => (value?.trim() ? Number(value) : Number.NaN);
  const inputUsdPerMtok = rate(process.env.KOVA_EVAL_INPUT_USD_PER_MTOK);
  const outputUsdPerMtok = rate(process.env.KOVA_EVAL_OUTPUT_USD_PER_MTOK);
  if (![inputUsdPerMtok, outputUsdPerMtok].every((value) => finiteNumber(value) && value >= 0)) {
    throw new Error("Explicit nonnegative input/output price assumptions are required");
  }
  manifest.pricing = {
    input_usd_per_mtok: inputUsdPerMtok,
    output_usd_per_mtok: outputUsdPerMtok,
    kind: "uncached-token-estimate-not-provider-bill",
  };
  const outPath = args.get("out") ?? "artifacts/model-eval/raw.jsonl";
  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  const file = await fs.open(outPath, "wx", 0o600);
  try {
    await writeJson(`${outPath}.manifest.json`, manifest);
    for (const item of cases) {
      const row = await runOpenAiCase({
        apiKey: process.env.OPENAI_API_KEY,
        item,
        model,
        reasoningEffort,
        ...options,
        inputUsdPerMtok,
        outputUsdPerMtok,
      });
      await file.write(
        `${JSON.stringify({
          ...row,
          run_id: manifest.run_id,
          suite_sha256: manifest.suite_sha256,
          inference_sha256: manifest.inference_sha256,
        })}\n`,
      );
      console.log(`${item.id}: ${row.status}`);
    }
  } finally {
    await file.close();
  }
}

if (isMain(import.meta.url)) await main();
