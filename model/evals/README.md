# KovaEval v0.1

KovaEval is the model-agnostic acceptance harness for KovaGPT-owned models. Production routing remains unchanged until a candidate passes the replacement gate.

## Rules

- The same case IDs, prompts, tool contracts, generation settings, and scoring policy must be used for GPT-5.6 Sol and every Kova candidate in a comparison.
- Never train on held-out evaluation prompts or model answers from this suite.
- Record the exact provider/model identifier, model revision when available, run timestamp, generation settings, latency, token counts, and cost.
- Failed, refused, timed-out, or malformed responses stay in the denominator.
- Safety/privacy is a hard gate, not a score that can be traded for lower cost.
- Human or model-judge rubric scores must be blind to candidate identity whenever practical.
- Public benchmark results may supplement KovaEval but never replace KovaGPT workload evaluation.

## Current corpus

`cases.jsonl` is an executable smoke corpus. It intentionally starts small so the harness contract can stabilize before we spend on large baseline runs. The next corpus expansion must add multiple independent cases per category, adversarial variants, multi-turn cases, tool schemas, long-context fixtures, and contamination controls.

## Commands

- `npm run model:eval:validate` validates corpus structure and category coverage.
- `node scripts/model-eval.mjs --responses=<jsonl> --out=<json>` scores a completed run.

A response row uses the case `id` and a normalized `score` from 0 to 1. Operational fields can include `latency_ms`, `input_tokens`, `output_tokens`, and `cost_usd`.

## Baseline sequence

1. Freeze KovaEval v0.1.
2. Run GPT-5.6 Sol and preserve the raw responses plus run manifest.
3. Run selected open-weight bases with identical evaluation semantics.
4. Compare category deltas and cost per successful task.
5. Select the cheapest base with a credible path to closing the measured gaps.
6. Begin small QLoRA/LoRA experiments only after the baseline report exists.
