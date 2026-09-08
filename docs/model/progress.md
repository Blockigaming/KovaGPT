# KovaGPT Model progress

Updated September 8, 2026. Development remains isolated to PR #312 and the branch
`model/kova-eval-foundation-20260908`. No merge or production change is included.

## Verified in this work session

The inspected starting head was `cb2d7357f328e6da51ed377ec834972c6d9a22d5`.
Azure Container Readiness passed there. KovaGPT CI run `34237637181` failed at
changed-file formatting before unit tests, lint, typecheck, or build ran.

Local model-only verification on Node 22.16.0 passed 51 tests after the integrity
changes. All three local corpus files were checked against their exact Git blob
hashes. Default validation and provider dry-run both select the 30-case suite.
These are local source tests and mocked transport tests, not a live model baseline
or proof that the repository-wide Node 24 CI has passed.

Implemented integrity work includes strict scores and weights, duplicate/unknown-ID
rejection, explicit missing/failed response handling, null-preserving incomplete
metrics, conservative grading, reference-aware metadata-blind judging, hash
comparison, safe diagnostics, bounded timeouts, default dry runs, and checkpointed
non-overwriting artifact output.

## Model progress, without fabricated percentages

- Evaluation software: implemented; exact-head CI and independent review required.
- Public smoke suite: 30 cases across 12 topic categories; not private holdout evidence.
- Verified paid baseline runs: none in this work session.
- Verified open-weight candidate runs: none in this work session.
- Verified trained Kova checkpoints: none in this work session.
- GPT-5.6 Sol replacement readiness: not established; production remains unchanged.

## Remaining work

Close current-head CI/review findings, enforce an owner-approved dollar ceiling,
run a small authorized baseline, calibrate graders with independent labels, and
build genuine execution/long-context/multimodal holdouts. The current request/token
limits and estimated costs must not be described as a complete billing cap.

Only after reliable reference/candidate results exist should model selection or
training spend be decided. Preserve this distinction between evaluation-software
progress and actual trained-model capability in every status update.

## Percentage convention requested by Zachary

**KovaGPT Model progress: 5% (1 of 20 recorded engineering checkpoints).**

The machine-readable ledger is `model/evals/program-progress.json`. Run
`node scripts/model-eval-progress.mjs` to calculate its percentage. A verified
checkpoint contributes five percentage points; pending or blocked work contributes
zero. This is a count of engineering milestones, not a claim that Kova has 5% of
Sol's intelligence, or that 5% of the required time, money, or effort has elapsed.
Evidence entries record why a checkpoint was marked verified; the command does not
contact GitHub or independently authenticate those entries.

The first checkpoint covers offline evaluation integrity. On source head
`18cac41f18fdf06510cb78535b9aeedb2fa40a3c`, the model-source workflow
`34240975060` passed. Its artifact was downloaded, checked against its SHA-256,
and its 51 tests reproduced locally. Six additional end-to-end regression tests
exercise all 30 smoke cases through mocked generation, deterministic grading,
mock rubric judging, scoring and comparison. They also cover missing cases,
pending grades, mismatched hashes, checkpoint preservation and unknown judge costs.
Three progress-ledger tests verify the percentage calculation and evidence checks.

These are software tests, not additional benchmark answers or trained weights.
No paid baseline, candidate run, training, merge or production change was performed.
Full exact-head CI and independent review remain separate, unverified milestones.
Reaching 100% in the ledger never authorizes a merge, purchase or deployment.
