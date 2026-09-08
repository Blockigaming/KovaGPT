# Kova model program

## Objective
Build a Kova-owned model that can eventually replace GPT-5.6 Sol in KovaGPT without lowering quality, safety, reliability, latency, or tool-use performance. KovaGPT continues using GPT models in production until a Kova candidate passes the replacement gate.

## Cost strategy
Do not train a frontier model from scratch. Start from a strong open-weight base and improve it through targeted post-training.

Initial candidate class:
- Primary low-cost starting point: Qwen3.8-27B or a similarly capable ~20B-40B open-weight model with commercially acceptable licensing.
- Prefer LoRA/QLoRA and adapter training before full-parameter training.
- Use larger or proprietary models only as permitted teachers/references; training data must respect provider terms.
- Prefer spot/preemptible GPU capacity where checkpointing makes interruption safe.
- Quantize experiments and inference where quality stays inside acceptance thresholds.

## Phases
1. Evaluation foundation: general chat, reasoning/math, coding, long context, tool use, agents, deep research, safety, factuality, KovaGPT-specific behavior, latency and cost.
2. Baseline untouched open-weight candidates against GPT-5.6 Sol using the same harness.
3. Supervised post-training on clean, licensed, provenance-tracked data focused on measured gaps.
4. Preference/reasoning optimization only after SFT improvements plateau.
5. Tool and agent specialization for function calling, planning, recovery, and long-horizon execution.
6. Compression/serving optimization with distillation and quantization.
7. Privacy-safe shadow evaluation beside GPT-5.6 Sol where permitted.
8. Controlled canary rollout with immediate GPT fallback.

## Replacement gate
A Kova model may replace GPT-5.6 Sol only when a frozen, reproducible evaluation shows:
- no material regression in any critical capability;
- equal or higher weighted KovaGPT aggregate quality;
- equal or better safety/privacy and hallucination/factuality results;
- equal or better tool-call validity and end-to-end task success;
- equal or better coding, agentic, long-context, and deep-research performance;
- acceptable P95 user-visible latency;
- lower cost per successful task or another compelling product advantage;
- no statistically meaningful quality regression in shadow/canary testing;
- exact weights, tokenizer, serving code, prompts, safety stack and eval artifacts are versioned and reproducible.

## Dataset rules
- Record source, license, provenance, preprocessing history and allowed use for every shard.
- Maintain strict train/eval separation and contamination checks.
- Do not train on private KovaGPT conversations without explicit consent and policy support.
- Never use secrets, credentials, private connectors or raw production logs as default training text.
- Label synthetic data with generator model, prompts/settings, date and filtering pipeline.
- Preserve a small high-quality human-written gold set for validation rather than repeatedly training on it.

## Spend gates
1. No expensive run without a baseline and a hypothesis tied to a measured gap.
2. Start with the smallest representative dataset and cheapest adapter run.
3. Scale compute only when the previous run improves held-out evaluation.
4. Stop experiments that fail early checkpoints.
5. Track dollars per benchmark-point gained and dollars per successful KovaGPT task.

## Initial milestone
Establish reproducible baselines for GPT-5.6 Sol, Qwen3.8-27B, and at least one efficient MoE/open-weight alternative before meaningful training spend. A tiny adapter smoke test is the only training work allowed before the baseline exists.
