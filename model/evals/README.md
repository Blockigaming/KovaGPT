# KovaEval v0.1 smoke evaluation

## Current status

The default suite is `kovaeval-v0.1.jsonl`: 30 public, model-authored smoke cases in
12 categories. The original nine-case file and 15-case expansion remain unchanged
for traceability. The suite is not a private held-out benchmark and does not
establish statistical parity with GPT-5.6 Sol.

The agent, tool, research, and multi-turn labels describe the topics of these
smoke prompts. The two frozen long-context cases each contain more than 32,768
characters and place answer-bearing evidence after the first 24,000 characters;
they remain smoke retrieval checks, not million-token coverage. The suite does
not execute tools, run candidate code in a sandbox, exercise a real agent loop,
or evaluate images. Those are separate acceptance-suite requirements.

No real baseline, candidate inference, model training, or production replacement
has been verified by this source change. A passing infrastructure unit test is
not a model capability score.

## Local commands: no credentials or API calls

```sh
node --test tests/unit/model-eval*.test.mjs
node scripts/model-eval.mjs
node scripts/model-eval-run-openai.mjs
```

Every command uses the complete smoke suite by default. A different dataset must
be supplied explicitly using `--cases=<path>` consistently at each stage.
The provider runner is a dry run unless `--execute` is present. The judge also
requires explicit execution; an API key alone does not enable a live run.

## Pipeline after separately authorized API execution

```sh
node scripts/model-eval-grade.mjs --responses=<raw.jsonl> --out=<deterministic.jsonl>
node scripts/model-eval-judge-openai.mjs --grades=<deterministic.jsonl>
node scripts/model-eval.mjs --responses=<fully-graded.jsonl> --out=<report.json>
node scripts/model-eval-compare.mjs --reference=<reference-graded.jsonl> --candidate=<candidate-graded.jsonl> --out=<comparison.json>
```

The judge command above is a dry run. Live runner/judge execution requires
`--execute` and an explicit `--max-requests=<integer>` covering all selected
requests, a server-side credential, and explicit price assumptions. Never paste
or commit credentials. Runner price inputs are `KOVA_EVAL_INPUT_USD_PER_MTOK` and
`KOVA_EVAL_OUTPUT_USD_PER_MTOK`; judge inputs use the corresponding
`KOVA_EVAL_JUDGE_INPUT_USD_PER_MTOK` and `KOVA_EVAL_JUDGE_OUTPUT_USD_PER_MTOK` names.

These controls bound request count, per-request output tokens, and timeouts. They
are not an independently verified hard dollar cap. Owner approval of an actual
spend ceiling and suitable billing enforcement is still required before live
execution. No live execution or credential creation is authorized by these docs.

## Integrity rules

Duplicate IDs, extra responses, unknown statuses, invalid weights, negative
metrics, and nonnumeric scores are rejected. Null, blank, boolean, or numeric-string
scores never become a valid grade. Missing responses become explicit failures at
the grading stage; incomplete final input is rejected by aggregate scoring.
Failed, timed-out, cancelled, and incomplete generations remain in the denominator
with zero scores. A legitimate completed privacy refusal is judged against the
rubric, rather than automatically failed.

A bare exact answer can be graded deterministically. Natural-language explanations
and semantic equivalents require rubric review; mentioning the expected number
somewhere is not sufficient evidence. Unrecognized fruit names also go to review,
so an incomplete dictionary does not silently reject a valid answer.

Unknown cost, token usage, or latency remains null. Reports include coverage and
observed subtotals, and suppress ratios when either full total is missing. Candidate
inference and judge costs are separate. Token-rate calculations are labeled
uncached-token estimates, not actual provider invoices; caching, cache writes,
service tiers, long-context pricing, and hosted-tool charges require reconciliation
before any real cost-per-task acceptance decision.

Runner manifests record the selected model, run ID, timestamp, suite digest, and
inference settings. Content and scoring hashes are carried into graded rows. The
comparison rejects conflicting hashes, categories, weights, and mixed run metadata.
Legacy rows lacking hashes are explicitly unverified. Matching hashes detect
accidental drift; they are not signatures or independent proof of live execution.

The aggregate is a case-weighted smoke score, not the separate replacement-gate
policy. Comparison reports always set `replacement_eligible: false`. Do not treat
relative scores as a universal percentage of Sol's intelligence.

## Judge and privacy limits

Judge input excludes provider/model metadata and includes the task, rubric,
reference answer where applicable, and answer text. Answers can still reveal their
own identity or contain prompt-injection attempts. The judge is instructed to treat
answer text as untrusted, but this is not a proven defense or proof of unbiased
scoring. Independent human calibration and cross-judge checks remain necessary.

Requests set `store: false`, which is not the same as Zero Data Retention or a
promise that every provider log is disabled. Review the applicable provider data
controls before using any sensitive data. This suite contains no private user chats.
Error diagnostics use safe codes rather than echoing provider bodies or exceptions.

Artifacts are written exclusively, with restrictive local permissions; existing
files are not overwritten. The runner and judge checkpoint completed rows.
Interrupted or failed judging cannot generate a valid complete report. Review any
partial artifact before repeating a paid run. Keep raw/graded outputs in ignored
local storage, not the public training corpus. No dataset or provider response is
approved for training without provenance, consent, licensing, and terms review.

## Next acceptance milestones

First pass exact-head CI and independent review. Then add an actual budget-enforced
pilot execution, calibrated judging, independent private holdouts, executable coding
and tool tasks, genuine multi-turn/long-context/vision evaluations, and per-category
statistical acceptance gates. Only after credible baselines should training spend
begin. GPT models remain the production path throughout this work.

Primary references, checked September 8, 2026:

- OpenAI model documentation: `https://developers.openai.com/api/docs/models/gpt-5.6-sol`
- OpenAI data controls: `https://developers.openai.com/api/docs/guides/your-data`
