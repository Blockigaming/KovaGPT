# Model evaluation: review repairs and first executable tool probe

KovaGPT Model progress: **5%**, using the existing 1-of-20 engineering-checkpoint ledger.
This change does not complete another checkpoint or establish any trained-model capability.

## Exact starting state

PR #312, branch `model/kova-eval-foundation-20260908`, starting head
`e7ff9cd9a2b48339f67c65bdce54138d5e661962`.
The four findings in review `5143596292` are addressed in source and regression tests:

- `3959450618`: reject differing returned generation model IDs within a completed run;
  missing actual identity marks the comparison unverified.
- `3959450629`: preserve `judge_returned_model`, require consistency within a judged run,
  and reject incompatible actual judges across compared runs.
- `3959450637`: request strict Responses API `text.format` JSON schema, retain local
  score/rationale validation, and include the schema in the scoring hash.
- `3959450650`: preserve significant casing, whitespace and characters for nonnumeric
  exact answers. Numeric/currency normalization is restricted to bare decimal answers;
  exact decimal comparison avoids floating-point rounding false positives.

Requested model aliases and actual provider-returned IDs remain distinct. Neither an ID
nor a matching hash proves execution independently or detects an undisclosed provider
weight change. These reports remain non-authorizing smoke evidence.

## Executable tool probe

`scripts/model-eval-tool-probe.mjs` exports `runToolProbe(respond)`.
It provides two strict function schemas, consumes emitted function calls, validates their
arguments, executes fixed read-only in-memory fixtures, supplies function-call outputs,
and requires a correct final structured answer. Narrating a plan or guessing the answer
without calling both tools earns zero. Unknown tools, duplicate calls, invalid arguments,
timeouts, provider errors, and model changes do not pass.

The probe cannot invoke production connectors, shell commands, or candidate-generated code.
Its responder is injected by the caller; tests use deterministic scripted responses, not an
LLM. It has no live-provider CLI. This is one public synthetic conformance probe, not a
private held-out evaluation, comprehensive agent benchmark, or live model result.
The original 30-case text smoke suite is unchanged.

## Verification

The seven starting evaluation scripts were verified against their Git blob hashes on the
exact starting head. All 60 existing model tests passed locally before editing. With 21 new
review-regression tests and 10 executable-tool-probe tests, 91 model tests passed on local
Node 22.16.0. These are software/mock tests. GitHub checks and independent review must
still be assessed on the final committed head, not inherited from predecessor commits.

```sh
node --test tests/unit/model-eval*.test.mjs
node scripts/model-eval.mjs
node scripts/model-eval-run-openai.mjs
node scripts/model-eval-progress.mjs
```

No paid inference, training, key creation, merge, deployment or production change is part
of this work. Azure serving-path support, enforced approved spending, stricter acceptance
manifests, independent holdouts, real coding/agent execution and genuinely long inputs
remain required before model-selection or replacement decisions.

## API references checked September 8, 2026

- Structured Outputs: `https://developers.openai.com/api/docs/guides/structured-outputs`
- Function calling: `https://developers.openai.com/api/docs/guides/function-calling`

Structured JSON improves response-format reliability; it does not guarantee correct or
unbiased judging. Local validation and independent calibration are still necessary.
