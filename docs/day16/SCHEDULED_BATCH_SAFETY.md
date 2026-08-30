# Scheduled batch safety checkpoint

## Verified prerequisite

The user supplied a successful local run of `verify-preview-repair.sh` against
`5ebf3504ec03dd676e696fdb399de589aaceb48f`: 33 regression tests, 328 integration
tests, TypeScript, lint, production build, local HTTP headers, a WebKit diagnostic
with hydration ready and zero recorded runtime events, and two WebKit theme tests.
That is 363 passing test cases across those three suites, not full product or
full browser-matrix completion. The temporary local preview blocker is closed.

## Implemented in this patch

The existing serial scheduled executor now claims one task immediately before
processing it instead of leasing the whole batch up front. Expired-lease recovery
runs once per batch. Limits must be integers from 1 through 25, defaulting to 5.
Malformed claim batches, repeated task IDs within a batch, invalid execution
inputs, foreign worker claims and expired leases stop before generation. Lease
validity is rechecked after the history write.

Provider errors and completion-settlement errors now have separate paths. Once
generation succeeds, a failed, missing or malformed completion acknowledgement
stops the batch. It is not converted into a provider failure, and the batch does
not issue a contradictory failure settlement or claim another task. Provider
error response bodies are discarded rather than read into memory for no purpose.

Existing per-call output limits, run identity and safe provider-error
classification are preserved. No database schema or deployment configuration is
changed. The scheduled-task availability flag remains false.

## Offline behavioral evidence

`tests/unit/scheduled-batch-safety.test.mjs` executes the actual TypeScript module
with isolated database/provider adapters and a deterministic clock. All imports
are explicitly substituted; no connected database or AI provider is called.

- Original executor with the new acceptance tests: 10 passed, 37 failed.
- Patched executor: 47 passed, 0 failed.
- Full-repository typecheck/lint and existing scheduler-related test contracts
  still require the local `verify-scheduled-batch.sh` gate.

These are executor-control-flow tests, not proof of deployed SQL, provider quota,
notification delivery, ownership isolation in a real database, or production
scheduled execution. No production ledger item is promoted.

## Tradeoff and remaining work

For a full batch of N processed tasks, the executor makes N claim calls rather
than one. When the queue empties before the limit, it makes one additional empty
claim and stops. A full default batch of five therefore adds four claim round
trips while avoiding pre-leased tasks waiting behind earlier generations. Lease
recovery still runs once per batch. No polling or retry sleeps are added.

A local expiry check cannot replace database fencing or stop a lease being
revoked after the check. Ambiguous provider/settlement outcomes can still be
reprocessed by later recovery. This patch does not establish global exactly-once
execution or billing. Persisted provider receipts, occurrence/attempt separation,
fenced settlement, lease renewal, transactional history writes and recovery
reconciliation remain release blockers. In particular, the legacy history upsert
and database settlement protocol need replacement before enabling the scheduler.

The remaining plan also includes least-privilege owner RPCs, canonical plan
entitlements, timezone/DST and missed-run semantics, a bounded one-shot worker,
Azure Job wiring, task history/edit/retry UI, delivery, observability, and
end-to-end verification. Keep the feature disabled until those gates pass.

## Next verification

```bash
bash scripts/release/verify-scheduled-batch.sh
```

This command does not build, run a browser matrix, apply migrations, enable a
worker, dispatch GitHub Actions, deploy Azure resources, push changes or use
Lovable. Preserve the successful preview evidence instead of rerunning it.
