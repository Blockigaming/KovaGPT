# KOVA-AUD-003 — Scheduled Tasks execution implementation-readiness plan

**Status:** investigation and implementation plan only; scheduled execution is **not implemented or deployed** by this document.  
**Repository revision audited:** `cd2f9772db1496c96ab0915f643cd63a8a06e4e4`  
**Audit date:** 2026-08-28  
**Boundaries:** no production, Supabase data, Azure, Cloudflare, DNS, billing, secret, or external-account changes were made.

## Executive decision

Use an **Azure Container Apps scheduled Job** in each Azure environment, running every minute in UTC with one job replica and a dedicated, non-HTTP scheduled-worker entry point built from this repository. The job uses the existing Container Apps environment, ACR image provenance flow, user-assigned managed identity, Key Vault references, Azure OpenAI managed-identity access, Log Analytics, and Application Insights. It calls service-role-only Supabase RPCs to atomically materialize and claim due occurrences, executes the existing `chatCompletions` provider path, heartbeats its lease, and atomically settles task, occurrence, attempt, usage, and notification-outbox state.

Supabase remains the system of record for schedules, owners, entitlements-at-claim, leases, occurrences, attempts, delivery state, and RLS. Azure supplies compute, triggering, identity, logs, metrics, alerts, and dashboards. Cloudflare has no scheduler or execution role; it may remain approved DNS/edge in front of the web application. No Lovable route, runtime, service, credential, or fallback participates.

This is the smallest production-grade choice because execution is already database-leased and batch-shaped, the repository already provisions Container Apps/ACR/managed identity/Key Vault/Log Analytics/Application Insights, and no per-task broker is required at the expected initial scale. The existing internal HTTP endpoint is useful as a staging/manual diagnostic only; production scheduling should not depend on public ingress or a shared bearer token.

## Evidence and current state

### 1. Database schema and RLS

`scheduled_tasks` was introduced with:

- UUID `id`, required `user_id` with `auth.users` cascade deletion;
- `title`, `prompt`, `run_at`, `repeat` (`none|daily|weekly|monthly`), and `status` (`scheduled|running|paused|completed|failed`);
- `last_run_at`, `next_run_at`, `last_result`, timestamps, owner/run-time index, and update trigger;
- `SELECT/INSERT/UPDATE/DELETE` to `authenticated`, all privileges to `service_role`;
- RLS enabled with one ALL policy requiring `auth.uid() = user_id` in both `USING` and `WITH CHECK`.

Later migrations add `worker_id`, `lease_expires_at`, `execution_attempts`, `retry_after`, `last_failure_type`, `last_error`, due/lease partial indexes, and service-role-only claim, recovery, and settlement RPCs.

`scheduled_task_runs` has a text primary key, task/user ownership, scheduled/start/complete timestamps, statuses, result summary, delivery/failure/retry fields, safe logs, next run, and unique `(task_id, scheduled_for)`. Authenticated users have only an owner-scoped SELECT RLS policy. `notification_deliveries` and `app_notifications` provide owner-readable notification evidence.

**Security strengths:** claims and settlements use `SECURITY DEFINER`, fixed `search_path`, explicit service-role checks, revoked public/anon/authenticated execution, `FOR UPDATE SKIP LOCKED`, worker/lease ownership checks, and owner IDs copied into history.

**Production gaps:** users can directly update execution-owned columns because the broad table UPDATE grant/policy has no column/state-transition guard; delete cascades erase run history; task/run ownership consistency is not enforced by a composite FK; retries overwrite the one occurrence row; lease recovery does not record an abandoned attempt; claims do not recheck entitlement; and claim plus run-start insertion is not one transaction.

### 2. Current UI and persistence behavior

The authenticated Scheduled Tasks page checks subscription state, lists owner rows, searches and filters them, and shows task status/last result. When execution is unavailable it truthfully hides creation and Automation Builder, disables resume/retry, and permits review, pause, and delete. The server hard-codes `scheduledExecutionAvailable = false`; create fails before insert and resume/retry fails before update. Thus **new schedules are not persisted at all** in the unavailable deployment. Existing rows are persisted truthfully and remain reviewable/pauseable/deletable; pausing and deletion persist, while resume cannot persist. There is no edit form for title, prompt, date, or recurrence despite the backend accepting those updates.

The browser converts `datetime-local` through `new Date(...).toISOString()`, preserving only an instant. The resolved browser zone is displayed but is not stored. Repeats are four coarse values and recurrence is computed from timestamps, not the user's wall-clock rule.

The page does not list `scheduled_task_runs`; “history” is only tasks whose status is `completed`, and the task row exposes only the latest denormalized result.

### 3. Execution code that exists

There is substantial dormant execution code:

1. `POST /api/internal/scheduled-execution` accepts a constant-time-compared bearer secret and invokes a batch of ten.
2. `runScheduledExecutionBatch` recovers expired leases, atomically claims due tasks, then executes them sequentially.
3. An occurrence ID is deterministically derived as `<task UUID>:<scheduled timestamp>` and upserted into `scheduled_task_runs`.
4. The task uses the existing balanced AI provider with a constrained scheduled-task system prompt.
5. Failures are classified as temporary/permanent/authorization/timeout; database settlement retries temporary/timeout failures at 1, 5, and 15 minutes, stopping before attempt 4.
6. Success/failure settlement updates task and run together and records an in-app notification where preferences allow it.

Source-level tests assert these contracts. This is an execution **engine and ingress**, not a deployed background system.

### 4. Exact root cause of non-execution

Execution is unavailable because no deployed timer, job, or worker calls the dormant engine, and the Azure Bicep templates provision only the web Container App. Neither Bicep template provisions a Container Apps Job, Function, Service Bus, or Storage Queue. No scheduler credential is wired into Azure infrastructure. The separate `worker/` image deliberately reports `agent_runtime_unavailable` and performs no work. Finally, product code deliberately hard-codes availability false, so creation and resume fail closed even if the HTTP secret and AI provider happen to exist. `scheduledExecutionReadiness()` exists but is not connected to the entitlement response and would prove only credentials/provider presence—not scheduler health.

This fail-closed state is correct today: a secret or dormant endpoint must never be treated as proof that a scheduler is alive.

## Azure mechanism comparison

| Option                                              | Fit                                                                                                                                                                                                                                                            | Decision                                                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure Container Apps scheduled Job**              | Native cron trigger, finite executions, retry/timeout controls, same Container Apps environment/ACR/identity/log pipeline, and ideal for the existing bounded database-claim batch. Cron only needs to wake the database-backed scheduler.                     | **Chosen.** One UTC minute trigger, parallelism 1, replica completion 1, bounded execution timeout/retries. Supabase remains authoritative, so overlapping job starts are safe. |
| Azure Functions timer trigger                       | Mature timer semantics and monitoring, but introduces a Functions app, storage account, host/runtime packaging, deployment path, and a second application framework absent from the repo. Timer singleton behavior does not remove database idempotency needs. | Reject for initial delivery; reconsider only if the organization standardizes on Functions.                                                                                     |
| Azure Service Bus                                   | Excellent broker, dead lettering, locks, sessions, and managed-identity authorization. It would require a dispatcher plus consumer, namespace/queue, outbox publishing, and reconciliation. It duplicates the durable due queue already in Postgres.           | Reject at current scale. Add only when fan-out/latency/throughput measurements justify it.                                                                                      |
| Azure Storage Queues                                | Cheaper simple broker, but still requires dispatcher, storage, poison handling, and dual-write/outbox reconciliation, with fewer controls than Service Bus.                                                                                                    | Reject; no present need for a broker.                                                                                                                                           |
| Always-on Container App worker                      | Reuses the platform but pays idle cost and requires a polling/leadership loop and deployment lifecycle.                                                                                                                                                        | Reject; scheduled Job is simpler and finite.                                                                                                                                    |
| `pg_cron`/Supabase Edge Function or Cloudflare Cron | Could wake execution, but violates the finalized Azure execution/observability boundary, creates provider/runtime coupling, or routes work through edge infrastructure.                                                                                        | Reject. Supabase stores/coordinates state only; Cloudflare remains DNS/approved edge only.                                                                                      |

## Target architecture and execution flow

1. The web API validates owner, entitlement, limits, schedule rule, timezone, and delivery selection. A database RPC creates/updates the task and computes its first `next_run_at`; clients cannot write execution columns.
2. Every minute, an Azure Container Apps Job starts the dedicated scheduled-worker image with `triggerType: Schedule` and UTC cron `* * * * *`. Job-level retries cover startup/infrastructure failure only; application attempts remain database-controlled.
3. The worker validates environment, emits a correlation/job execution ID, and calls one service-role RPC that:
   - records a scheduler heartbeat;
   - locks due eligible tasks with `FOR UPDATE SKIP LOCKED`;
   - rechecks active/trialing paid entitlement and task limits/policy;
   - applies missed-run policy and materializes a stable occurrence row;
   - creates a unique attempt row;
   - marks the task/occurrence claimed with a lease token, worker ID, and expiry;
   - returns only the claimed immutable execution snapshot.
4. The worker executes claims with a small bounded pool (initially 2), one active occurrence per task and one per owner by default. It refreshes leases while provider work is active.
5. Settlement RPCs require task ID, occurrence ID, attempt ID, and opaque lease token. They lock and verify current ownership/version, settle the attempt and occurrence, advance recurrence in the stored IANA zone, reserve/settle AI usage atomically, update denormalized task state, and enqueue a delivery outbox row.
6. A delivery pass in the same Job drains in-app outbox entries. Email is off by default until the existing non-Lovable email dispatcher is independently production-proven; notification failure never reverses execution success.
7. The worker emits structured, content-free operational logs and metrics to Container Apps/Log Analytics/Application Insights. The web reports availability only from a fresh database heartbeat plus required schema/provider configuration and an operator feature flag.

### Worker artifact boundary

Do not extend `worker/src/index.mjs`; it is an intentionally unavailable agent-runtime placeholder with a different lifecycle. Add a dedicated `scheduled-worker/` package/container entry or a separately bundled server entry in the main image. Prefer a separate minimal runtime target that imports shared provider/execution modules, contains no browser bundle, exposes no port, runs one batch/drain cycle, and exits nonzero only for job-level/infrastructure failures. Build and deploy it by immutable ACR digest using the existing provenance conventions.

## Scheduling semantics

### Atomic claims

Replace the split `claimTasks()` / `writeRunStart()` sequence with a single `claim_due_scheduled_task_occurrences(...)` RPC. Candidate ordering is effective due time then UUID; rows use `FOR UPDATE SKIP LOCKED`. Within the transaction, create or find the occurrence by `(task_id, scheduled_for)`, insert a new attempt, set lease token/expiry and snapshot fields, and return the claim. An occurrence is executable only when the task is enabled, not deleted/cancel-requested, entitlement is valid, due time is reached, and no live lease exists.

Use an unguessable `lease_token` rather than worker ID alone. Heartbeat and settlement must match the token, task/occurrence/attempt, and a task `state_version`. A recovery RPC expires attempts and makes retry decisions; it must never silently flip `running` to `scheduled`.

### Idempotency

- Stable occurrence key: UUID (or hash) derived/uniquely constrained by `(task_id, scheduled_for)`; never by claim time.
- Each execution try is a distinct `scheduled_task_attempts` row with a monotonic `attempt_number` and unique `(occurrence_id, attempt_number)`.
- Claim/materialization, usage reservation, settlement, and notification outbox insertion are transactional RPCs.
- Settlement is compare-and-set and idempotent: repeating the same terminal settlement returns the existing result; a different/stale token is rejected.
- Notification dedupe key is `(occurrence_id, channel, event_type)`; delivery provider keys use the outbox UUID.
- AI generation itself cannot be guaranteed exactly once after a crash between provider response and settlement. The system is at-least-once with durable dedupe around side effects; prompts must remain read-only until tool-specific idempotency keys exist.

### Retry/backoff

Application policy: maximum 4 attempts total. Suggested delays are **1 minute, 5 minutes, and 15 minutes plus 0–20% deterministic jitter**, capped so retries cannot cross task cancellation/end boundaries. Retry 408/429/provider 5xx, network errors, and timeouts; honor provider `Retry-After` within a 30-minute ceiling. Do not retry authentication/authorization, invalid request/prompt, missing entitlement, or policy failures. Azure Job retries are 1 (or at most 2) with a short timeout and exist only for container startup/fatal batch failure; they must not increment an occurrence attempt unless a claim was created.

### Missed runs

Default recurring policy is **coalesce/latest**: after downtime, materialize at most one occurrence—the most recent due wall-clock occurrence within a 24-hour grace window—then advance directly to the first future occurrence. Record earlier missed occurrences as aggregate `missed_count`/`first_missed_for`, not a burst. One-time tasks run within 24 hours; older one-time tasks become `missed` and notify once. No catch-up flood. Make the grace policy explicit and versioned; do not offer “run every missed occurrence” initially.

### Concurrency

- Azure Job execution parallelism: 1; allow overlap at the platform level only if a prior minute is still finishing because DB leasing is authoritative.
- Worker pool: 2 initially; batch claim: 10; loop until empty or a 4-minute budget is reached.
- Per task: exactly one live occurrence.
- Per owner: one running task by default to prevent a single account monopolizing capacity; consider plan-based 1/2 limits only after load evidence.
- Global/provider rate limit and token budget remain enforced through the existing AI accounting path. Claim in short transactions; never hold a DB lock during provider calls.

### Disable, cancel, edit, and delete races

Pause/disable, edit, retry, and delete become owner RPCs rather than direct table updates. Each locks the task and increments `state_version`.

- Disable before claim: no claim.
- Disable during run: set `cancel_requested_at`; worker observes it on heartbeat and aborts. Settlement records `canceled`, never schedules the next occurrence, and does not deliver a completion notification.
- Editing schedule during run affects only the next occurrence; the running occurrence uses an immutable snapshot. Prompt edits during run likewise apply next time.
- Retry is allowed only for a terminal retryable occurrence and creates the next attempt; it does not rewrite `next_run_at` blindly.
- “Delete” is soft delete (`deleted_at`) so audit/history and in-flight cancellation survive. A later retention job may purge per documented policy. User/account deletion can still cascade as required by privacy policy.
- If cancellation wins after the provider returns but before settlement, settlement records canceled and discards result/delivery. This deterministic policy favors user intent.

### Timezone and DST

Store an IANA `time_zone` plus a validated local recurrence rule (recommended `schedule_rule jsonb` with schema version, frequency, interval, weekdays/day-of-month, local time, ambiguity policy) and retain `next_run_at` as the indexed UTC projection. Validate zones against the runtime's IANA database.

Compute occurrences in application code using one pinned timezone-aware library, with golden tests, then persist through RPC; do not use fixed `+ interval '1 day'` for wall-clock recurrence. Policy:

- nonexistent spring-forward local time: run at the first valid instant after the gap;
- duplicated fall-back local time: run once at the earlier offset;
- monthly day beyond month length: run on that month's last calendar day;
- store `scheduled_for` in UTC plus `scheduled_local`, `time_zone`, and `utc_offset_minutes` snapshot for audit.

The scheduler trigger itself remains UTC; user timezone affects occurrence computation only.

## Entitlements and isolation

Creation/update/resume/retry and **claim time** must use one canonical server-side entitlement function, not price-ID substring classification duplicated in Scheduled Tasks. Paid active/trialing subscriptions qualify only before `current_period_end`; plan limits must be transactional to prevent concurrent over-creation. On downgrade/expiry, do not execute: mark the task `paused_entitlement`, record a skipped occurrence reason, and notify at most once. Never let the worker infer paid access from a client claim.

Owner-facing operations use the authenticated Supabase client and owner RPCs/RLS. Worker RPCs remain service-role only. Add composite uniqueness/FKs so `scheduled_task_runs(task_id,user_id)` and attempts cannot associate one owner's history with another task. Revoke authenticated direct INSERT/UPDATE/DELETE on execution tables/columns, expose least-privilege owner RPCs, and retain owner-only SELECT policies. Worker logs must never include prompt/result, service keys, email addresses, tokens, or full user IDs (use a keyed pseudonymous owner hash).

## Execution history and delivery migrations

Add one forward-only migration after `20260824094500...` (suggested `supabase/migrations/20260828xxxxxx_scheduled_tasks_production_execution.sql`) that:

1. Adds task scheduling/control fields: `enabled`, `time_zone`, `schedule_rule`, `schedule_version`, `state_version`, `cancel_requested_at`, `deleted_at`, `missed_run_policy`, `last_scheduler_decision`, and optional entitlement-pause timestamp.
2. Backfills existing rows deterministically: timezone `UTC`, rule derived from existing `repeat/run_at`, enabled from active statuses. Existing tasks remain disabled/paused until owner confirmation—do not silently activate legacy rows.
3. Evolves `scheduled_task_runs` into one immutable occurrence record with `occurrence_id` UUID (or retains `id` with a new stable format), execution snapshot, terminal `missed|skipped_entitlement` statuses, missed metadata, and unique `(task_id, scheduled_for)`.
4. Creates `scheduled_task_attempts`: attempt ID, occurrence/task/user, number, status, worker and lease-token hash, claimed/heartbeat/start/finish timestamps, failure class/code, retry time, provider/request correlation IDs, safe diagnostic fields, and token/usage totals. Owner SELECT only; no client writes.
5. Creates `scheduled_task_delivery_outbox` with dedupe key, channel/event/status, available/lease/attempt timestamps, safe preview, provider correlation, and failure class. Owner may read delivery history but not mutate it.
6. Creates `scheduled_scheduler_heartbeats` (singleton per environment) with last start/success/failure, build SHA, duration, claimed/completed/failed counts, oldest due age, and safe error code. Authenticated users get no access; readiness uses a restricted RPC/view.
7. Adds due, lease-expiry, owner-history, outbox-due, and heartbeat indexes and composite ownership constraints.
8. Replaces claim/recovery/settlement functions with atomic occurrence/attempt-aware v2 RPCs plus heartbeat/cancel/owner lifecycle RPCs. Fully qualify objects, pin `search_path`, verify service role, revoke PUBLIC/anon/authenticated by signature, and grant only service role. Owner RPCs verify `auth.uid()` internally.
9. Revokes broad authenticated mutations (or column privileges) and replaces the ALL policy with explicit owner SELECT plus RPC-controlled writes.
10. Preserves v1 functions during a staging compatibility window if needed, then drops/revokes them in a later cleanup migration only after rollback expiry.

Migration must be rehearsal-tested from a fresh database and an upgrade fixture with legacy scheduled/running/failed tasks. A down migration is not the rollback mechanism; database rollout is expand/migrate/contract.

## Backend and UI changes

### Backend

- Replace the hard-coded boolean with `scheduledExecutionAvailability`: operator enable flag **and** recent successful heartbeat for the current environment/build/schema, plus provider and database readiness. Cache briefly and fail closed.
- Consolidate entitlement decisions into the canonical billing/usage service and call it in owner RPCs and claim RPC.
- Add owner functions to create, edit, disable/resume, cancel/delete, retry a terminal occurrence, list history with pagination, and fetch a safe result. Never accept `user_id`, worker state, or execution fields from clients.
- Split pure recurrence calculation, claim execution, heartbeat, settlement, and delivery into testable modules. Add timeout/AbortSignal and lease heartbeat around provider calls.
- Keep `/api/internal/scheduled-execution` disabled in production by default. If retained for staged/manual diagnostics, require Azure-private ingress or monitoring authorization, a separate secret, rate limiting, audit logging, and no response detail; it must not be the scheduled production path.
- Integrate AI usage reservation/settlement so scheduled work cannot bypass quotas/cost accounting.

### UI

- Enable create/resume only on proven availability; present an operationally degraded state without suggesting an upgrade fixes infrastructure.
- Add edit support for title, prompt, local start, IANA zone, recurrence, and notification channel; show DST semantics.
- Replace pause/delete direct semantics with disable/cancel/soft-delete confirmations and accurate in-flight states.
- Add paginated occurrence history and attempt status, safe failures, next retry, missed/skipped reasons, delivery state, and retry eligibility.
- Refresh after mutations and periodically while running; realtime is optional, not required for correctness.
- Maintain owner/principal reset protections and accessible labels/status announcements.

## Exact repository change map

The implementation PR(s) should change these existing files:

| File                                                                                                                                                                                                                                      | Required change                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/scheduled-tasks.functions.ts`                                                                                                                                                                                                    | Remove hard-coded false; use heartbeat availability; canonical entitlement; owner lifecycle/history RPC facades; stop direct broad table writes.                    |
| `src/routes/scheduled-tasks.tsx`                                                                                                                                                                                                          | Edit/timezone/recurrence controls, accurate lifecycle actions, occurrence/attempt history, delivery/missed/degraded states.                                         |
| `src/components/AutomationBuilder.tsx`                                                                                                                                                                                                    | Produce versioned timezone-aware rules and only advertise worker-supported read-only capabilities.                                                                  |
| `src/lib/scheduled-execution.server.ts`                                                                                                                                                                                                   | Use atomic occurrence+attempt claim, lease tokens/heartbeat/cancellation, bounded concurrency, usage accounting, idempotent settlement and structured metrics.      |
| `src/lib/scheduled-execution-readiness.server.ts`                                                                                                                                                                                         | Require operator flag, schema version, and fresh environment-specific successful scheduler heartbeat—not a secret alone.                                            |
| `src/lib/readiness.server.ts`, `src/routes/api/readyz.ts`                                                                                                                                                                                 | Surface safe scheduled-worker readiness to authorized monitoring without leaking secrets/tenant data.                                                               |
| `src/routes/api/internal/scheduled-execution.ts`                                                                                                                                                                                          | Diagnostic-only policy or removal from production; do not use as the Job's normal transport.                                                                        |
| `src/lib/scheduled-workflows.server.ts`                                                                                                                                                                                                   | Replace divergent prototype contract with the canonical recurrence/history types or retire it; add pinned zone-aware occurrence calculation.                        |
| `src/lib/billing-plans.ts`, `src/utils/usage.functions.ts`, `src/lib/ai/accounting.server.ts`                                                                                                                                             | Expose/reuse canonical server entitlement and atomic scheduled usage accounting; exact choice should follow current accounting ownership.                           |
| `src/integrations/supabase/types.ts`                                                                                                                                                                                                      | Regenerate/add v2 task, occurrence, attempt, outbox, heartbeat, and RPC types.                                                                                      |
| `infra/azure/staging/main.bicep`, `infra/azure/production/main.bicep`                                                                                                                                                                     | Add scheduled Container Apps Job, least-privilege identity/RBAC, Key Vault refs, job limits, logs, outputs, alerts/action-group parameterization, and feature flag. |
| `infra/azure/staging/main.parameters.example.json`, `infra/azure/production/main.parameters.example.json`                                                                                                                                 | Document non-secret Job/image/threshold parameters and secret URI inputs.                                                                                           |
| `.github/workflows/azure-container-ci.yml` and the protected Azure deployment workflow (`.github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml`, or a new explicitly protected production workflow) | Build/sign/scan/push immutable scheduled-worker image, validate Bicep, deploy by digest, and verify exact SHA without exposing secrets.                             |
| `Dockerfile` or new `scheduled-worker/Dockerfile`                                                                                                                                                                                         | Add minimal non-HTTP worker image/target with source provenance and non-root user. A new dedicated Dockerfile is preferred.                                         |
| `.env.example`                                                                                                                                                                                                                            | Document worker-only environment/flags without values; remove secret-as-readiness assumptions.                                                                      |
| `database-contract.json`, `release-migrations.json`, `release-rls-matrix.json`                                                                                                                                                            | Regenerate repository contracts after the migration; never hand-edit generated evidence if scripts own it.                                                          |
| `docs/feature-parity.md`, `docs/chatgpt-feature-parity.md`, `docs/production-readiness.md`, `docs/azure-staging-deployment.md`, `docs/azure/DEPLOYMENT_CHECKLIST.md`                                                                      | Update only after staging proof; retain truthful unavailable wording until rollout gates pass.                                                                      |

Add these files (names may use the actual next timestamp):

- `supabase/migrations/20260828xxxxxx_scheduled_tasks_production_execution.sql`
- `scheduled-worker/Dockerfile`, `scheduled-worker/package.json`, `scheduled-worker/src/index.ts` (or equivalent bundled entry)
- `src/lib/scheduled-recurrence.ts`, `src/lib/scheduled-entitlements.server.ts`, `src/lib/scheduled-observability.server.ts`, and optionally `src/lib/scheduled-delivery.server.ts`
- focused unit/integration/release tests such as `tests/unit/scheduled-recurrence.test.mjs`, `tests/integration/scheduled-execution-v2.test.mjs`, `tests/integration/scheduled-owner-isolation.test.mjs`, `tests/integration/scheduled-cancellation-races.test.mjs`, `tests/unit/azure-scheduled-job-template.test.mjs`, and staging smoke support under `scripts/azure/`.

Do **not** modify `wrangler.jsonc` or Cloudflare deployment to add execution. Do **not** connect any `src/routes/lovable/**` route.

## Observability, health, and alerting

Emit JSON records with timestamp, severity, event name, environment, build SHA, Azure Job execution ID, batch ID, hashed task/owner IDs, occurrence/attempt IDs, attempt number, latency buckets, outcome/failure code, retry decision, token counts, and delivery outcome. Never emit prompt, result, raw user ID, email, auth headers, provider body, or secrets.

Required metrics (Application Insights custom metrics or log-derived):

- job start/success/failure and last successful heartbeat age;
- due/claimed/completed/failed/retried/missed/skipped/canceled counts;
- oldest due age (scheduler lag), claim-to-start, execution duration p50/p95/p99;
- active/expired/recovered leases and settlement conflicts;
- provider status class/rate limit/timeouts and token/cost totals;
- outbox depth/oldest age/delivery success/failure;
- entitlement skips and per-owner fairness saturation.

Initial alerts: no successful heartbeat for 5 minutes; oldest due age >5 minutes for 5 minutes; job failure in 3 consecutive executions; expired leases >0 sustained 10 minutes; terminal failure rate >10% with a minimum volume; provider 429/5xx spike; outbox oldest age >10 minutes; daily cost/budget threshold. Route alerts through an operator-supplied Azure Action Group ID—no hard-coded recipient.

`/api/readyz` may report scheduled execution degraded/unavailable to authorized monitors based on the database heartbeat. The user-facing flag should require a heartbeat newer than 3 minutes. Liveness must not depend on an empty queue, and a scheduler outage must not make the whole web app unavailable.

## Security requirements

- Separate web and worker identities where practical; both may reuse the environment but the worker alone receives worker secrets. Managed identity is used for ACR, Key Vault, Azure OpenAI, and Azure monitoring. Supabase currently requires a Key Vault-held service role key; rotate it and scope exposure to the Job container only.
- No public worker ingress. No Cloudflare-to-worker invocation. Do not place service role, schedule secret, or provider keys in browser/Vite variables, image layers, logs, CLI arguments, outputs, or GitHub artifacts.
- All service-role RPCs check role and lease token, pin `search_path`, validate bounds, and revoke default execution. Owner RPCs bind `auth.uid()` and cannot accept owner identity.
- Restrict tasks initially to model generation/read-only behavior. Connector writes, browsing side effects, and external actions remain unsupported until each has explicit authorization snapshot, scoped credentials, cancellation, and idempotency contracts.
- Enforce prompt/result limits, provider timeouts, egress/provider allowlists, SSRF controls for future tools, retention/deletion policy, and safe user-visible errors.
- Verify zero Lovable runtime/service dependency with the existing strict zero-Lovable release checks.

## Rollout plan (six phases)

1. **Contract and migration (expand):** finalize unresolved product policies; add v2 schema/RPCs/RLS; backfill legacy rows disabled; update generated contracts; fresh/upgrade DB rehearsals.
2. **Worker and backend:** recurrence engine, atomic claims/attempts, heartbeat/cancel, entitlement/accounting, delivery outbox, structured telemetry; keep feature flag off.
3. **Azure staging infrastructure:** build immutable worker image; add staged Container Apps scheduled Job, identity/Key Vault/RBAC/logs/alerts; deploy only to isolated staging under approval.
4. **Staging verification and soak:** synthetic paid users/tasks, two-user isolation, DST and fault injection, duplicate/overlap/lease recovery, provider quota, notification, rollback drills; minimum 7-day soak with SLO evidence.
5. **UI controlled enablement:** history/edit/control UI; internal/operator cohort then small paid cohort. Availability requires feature flag and fresh heartbeat; legacy tasks require owner reconfirmation.
6. **Production readiness and cleanup:** protected production change review, deploy expand-first, canary/observe, enable gradually, document runbooks; only later contract/drop v1 RPC/HTTP scheduler secret after rollback window.

Estimated implementation phases: **6**. This is an estimate, not an implementation claim.

## Rollback strategy

1. Set the server-side Scheduled Tasks execution feature flag off: creation/resume stops immediately and UI returns to truthful history-only mode.
2. Suspend/disable the Azure scheduled Job. Do not delete it during incident response.
3. Request cancellation for active claims; wait one lease window. Recovery marks abandoned attempts safely. Do not blanket reset running rows.
4. Roll worker/backend to the prior immutable ACR digest and web revision if compatible. Expand-only schema remains in place.
5. Disable notification delivery drain if delivery is the fault; execution settlement remains independent.
6. Use v1 compatibility only if explicitly retained and verified; never roll database schema backward destructively. Repair/reconcile occurrences through an audited service-role script after snapshot/approval.
7. Preserve logs/history for incident review, rotate any suspected credential, and keep legacy tasks disabled until owner reconfirmation.

Rollback success criteria: no new claims, no live leases after timeout, no duplicate terminal occurrence/outbox rows, web remains available, owner data remains isolated, and UI states execution unavailable.

## Staging verification plan

Use an isolated staging Supabase project and Azure environment only. Apply migrations from empty and from an upgrade fixture. Deploy the exact worker digest and record build SHA. Seed two paid users, one free/expired user, schedules across UTC and DST zones, and synthetic provider outcomes.

Verify:

- heartbeat makes availability true only after success and becomes false after Job suspension;
- create/edit/disable/resume/delete/retry/history and plan limits;
- two simultaneous Job executions never duplicate an occurrence;
- crash after claim, during provider request, after provider response, and during settlement/outbox; lease recovery and idempotent replay;
- disable/edit/delete/account-deletion races and stale settlement rejection;
- transient retries/backoff/jitter/Retry-After and permanent no-retry paths;
- 24-hour coalescing, stale one-time missed behavior, and no catch-up flood;
- DST gap/fold, monthly-end, leap day, zone validation, and runtime timezone database consistency;
- downgrade between create and claim, quota exhaustion, concurrent creation limit;
- owner A cannot select/mutate owner B task/run/attempt/delivery and authenticated users cannot invoke worker RPCs;
- notification preference, dedupe, outbox retry, and notification outage independence;
- telemetry redaction, metrics, alerts, health thresholds, dashboard, exact SHA/image provenance;
- suspend Job/flag-off/digest rollback/recovery drill.

Run for at least seven days with minute schedules and controlled fault injection. Production enablement requires zero duplicate terminal occurrences, zero cross-user access, bounded lag/recovery within SLO, no leaked content/secrets, expected cost, signed owner/security review, and a rehearsed rollback.

## Required pre-production test matrix

| Area                   | Required cases                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recurrence             | once/daily/weekly/monthly; UTC and multiple IANA zones; DST gap/fold; month end; leap year; invalid/renamed zone; edit before/after due.                   |
| Claims                 | empty queue; boundary due time; ordering; 1/10/100 tasks; concurrent workers; overlapping Jobs; entitlement change; canceled/deleted row; lock contention. |
| Idempotency            | repeated claim, heartbeat, success/failure settlement, worker restart, same scheduled instant, provider-response/settlement crash, outbox replay.          |
| Lease/recovery         | heartbeat extends; stale token denied; timeout; recovery creates abandoned attempt; max attempts; cancellation during lease.                               |
| Failure/retry          | 408/429 with Retry-After; 5xx/network/timeout; 4xx/auth/policy; jitter bounds; max attempts; Azure startup retry does not double count.                    |
| Missed runs            | short outage, >24-hour outage, recurring coalescing, stale once missed, large backlog fairness.                                                            |
| Concurrency/fairness   | per-task and per-owner cap, pool bounds, long/short mix, starvation, provider/global throttling.                                                           |
| Entitlement/accounting | free/plus/pro/trial/expired/canceled; period boundary; concurrent plan limit; quota reservation/settlement/refund; downgrade after creation.               |
| Security/RLS           | signed out; two users; forged user ID; direct table mutation; worker RPC as authenticated; stale/forged lease; SQL bounds; log/response secret scan.       |
| UI/API                 | unavailable/degraded/ready; create/edit/control/history/retry; validation; pagination; running updates; responsive/a11y; truthful errors.                  |
| Delivery               | preferences on/off; in-app success/failure/cancel; dedupe; outbox retry/exhaustion; no private prompt/result in preview; email off until proven.           |
| Azure/IaC              | Bicep compile/lint/what-if; identity/RBAC; Key Vault refs; no ingress; cron/UTC; timeout/retry/parallelism; digest pin; logs/alerts/budget.                |
| Operations             | no-heartbeat, lag, lease, provider, outbox and cost alerts; dashboard; runbook; flag-off, Job suspend, digest rollback, schema compatibility.              |
| Regression             | current source tests, typecheck, lint, build, unit/integration/API/release suites, migration contract, strict zero-Lovable scan.                           |

## Highest-risk areas

1. **Exactly-once illusion:** provider generation cannot be rolled back; crash timing demands occurrence/attempt idempotency and read-only tasks.
2. **Cancellation and mutable task races:** current direct UPDATE/DELETE can invalidate leases or erase evidence.
3. **Timezone/DST correctness:** the current instant-plus-interval model does not preserve local wall-clock intent.
4. **Entitlement/cost bypass:** eligibility is checked only on owner mutation and via duplicated price-name heuristics, not at claim/accounting time.
5. **Lease duration:** the current fixed 120-second lease has no heartbeat and can expire during a legitimate generation, enabling duplicate work.
6. **History model:** retry upsert overwrites a single occurrence row and split claim/run creation leaves crash gaps.
7. **Availability truth:** credentials or an endpoint are not proof of a live scheduler; heartbeat/build/schema/environment binding is mandatory.
8. **Migration of legacy rows:** they must not begin executing merely because infrastructure becomes live.

## Dependencies and unresolved decisions

Dependencies: approved Azure subscription/resource group; existing Container Apps environment, ACR, managed identity strategy, Key Vault, Azure OpenAI deployments, Log Analytics/Application Insights; isolated staging Supabase with migrations and two-user fixtures; canonical subscription/accounting contract; protected CI/OIDC deployment; operator Action Group; product approval for retention, missed-run and notification policies.

Resolve before phase 1:

- Is one active run per owner acceptable for Plus and should Pro receive two?
- Confirm 24-hour missed-run grace and coalesce/latest behavior.
- Confirm DST gap/fold and month-end policies stated above.
- Confirm history/result retention and soft-delete/purge periods.
- Should legacy schedules require explicit owner re-enable (recommended: yes)?
- Is email launch out of scope initially (recommended: yes, in-app only)?
- What heartbeat/lag SLO and paid-task token/cost ceilings are approved?
- Is the existing production managed identity acceptable for the Job, or must security create a worker-specific identity (recommended)?
- Which protected workflow owns production Azure Job deployment?
- Does Supabase offer a narrower worker credential for these RPCs in the target plan? Until proven, isolate and rotate the service-role key in Key Vault.

## Investigation checks performed

The investigation used repository-wide `rg`/`find`, direct source/migration/IaC inspection, Git status/SHA inspection, JSON parsing, formatting checks, TypeScript/lint checks, and focused Day 14 execution/settlement tests. No deployed endpoint, account, or production resource was queried. Therefore runtime configuration and actual Azure/Supabase state remain deliberately unverified.
