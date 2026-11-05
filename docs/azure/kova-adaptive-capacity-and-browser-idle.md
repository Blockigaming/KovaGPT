# Kova adaptive capacity & cloud-browser lifetime — staging acceptance

## Approved product requirements

- Kova website/gateway remains responsive; do not scale the customer-facing API to zero.
- Kova Xenon 5, Neon 4.6 and Argon 5 use already-running pay-per-token inference providers until dedicated GPUs are economically justified. **Do not replace model versions when scaling.**
- Adjust Kova gateway capacity **once per UTC day** from verified hourly prompt records and recurring hour-of-day patterns, while Azure's ordinary HTTP/concurrency autoscaling handles sudden traffic spikes between reviews.
- Browser processes close after **15 minutes with no real activity**. Idle timer must not be reset by background status polling or presentation-only refreshes. Closing releases resources but cannot promise the provider stops charging immediately.
- Never make an unlimited cost commitment. Preserve existing production revisions, secrets, connected-user state and OpenAI fallback.

## Implemented on this draft branch

- Pure daily recommendation engine: `src/lib/ai/kova-daily-capacity-policy.mjs`.
  - Requires 24 consecutive fresh hourly samples.
  - Uses observed peaks and seven-plus-day UTC hourly patterns when available.
  - One-step maximum change per day, 1 always-on minimum replica, hard ceiling of 4, conservative 72-hour downscale rule.
  - Invalid/stale/missing telemetry causes no scaling.
- Read-only CLI: `node scripts/azure/kova-daily-capacity-plan.mjs hourly-metrics.json CURRENT_MAX_REPLICAS`.
- Isolated `src/browser-runtime/session-manager.ts` now defaults to a 15-minute idle timeout. Its separate absolute lifetime remains 30 minutes.

## Important separate Work browser implementation

The current Work cloud browser uses independent `work-runner/browser-manager.mjs` and `src/lib/work-browser.server.ts` authority, with **300-second absolute sessions enforced in PostgreSQL** (table `work_browser_sessions`). Do **not** claim the full cloud-browser 15-minute idle requirement is implemented by updating `BrowserSessionManager`. It needs an independently reviewed database migration, sliding expiry semantics with a hard maximum session lifetime, runner-side expiry reaping, and tests for idle termination, owner handoff, and session/account deletion.

## Required Azure activation (not performed by this document)

1. Using the authorized Azure subscription, inspect `kovagpt-prod-web` and its actual active revision, current max/min replicas, traffic rules, HTTP scaling rules and scope of the existing identity. Record rollback evidence. Never apply the migration-frozen production Bicep as a shortcut.
2. Identify the authoritative source of **completed and admitted user prompts**, not merely client analytics. Aggregate hourly counts with hour-start UTC timestamps and 5-minute peak RPS, covering at least 72 hours before permitting downscales. Never include raw prompt content or private identifiers in the scaling metrics.
3. Benchmark the CPU API gateway's sustainable throughput. Replace the policy's placeholder `sustainableRpsPerReplica: 2` only with measured capacity.
4. Configure Container Apps live HTTP/concurrency autoscaling with min replicas 1 and an approved budget-limited max; verify both scale-out and scale-in under synthetic traffic.
5. Schedule daily UTC recommendations through a narrowly scoped Azure job or existing production scheduler. Log the planned bound, metrics freshness and the _actual_ Azure update result, if applying. Enforce idempotency, least privilege, rollback and a circuit breaker. Do not let the job change model IDs, production routing, secrets, images or regions.
6. Apply changes only after source checks, tests, Azure identity verification, budget/cost evaluation and owner-approved first deployment. Triggering the read-only planner alone is **not** automatic resizing.
7. Deploy and verify the separate Work browser 15-minute idle expiry migration before changing its public timeout documentation.
8. Verify the deployed Kova revision, external/model first-token latency, plugin calls, image routing, browser cleanup and the old revision as rollback target.

## Failure and cost policy

- An unavailable hosted inference provider follows the existing compatible fallback policy; do not send a partial streamed response through another model and present it as the same continuation.
- If observed latency, errors or queue depth exceed safe thresholds, the live autoscaler should protect availability immediately; the daily planner is not a substitute.
- Daily automatic _replica ceiling_ adjustments change the potential spend. Treat a limit as safety guard, **not** as an Azure billing cap. Alert at budget thresholds, with a separate server-side hard quota for pay-per-token inference.
- If active production capacity differs from the prior day's plan, do not force it down without reconciling the operator change.
