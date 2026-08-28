# KovaGPT Work: production implementation-readiness investigation

**Status:** design complete; implementation and deployment not performed  
**Investigated:** 2026-08-28  
**Decision:** **NO-GO** for enabling Work execution in staging or production

## 1. Executive conclusion

The current Work experience is truthful and safely disabled, but it is not an execution system.
It is a historical-record viewer over `agent_jobs` with cancellation, approval denial, graph display,
evidence preview, and deliverable management. New `agent_jobs` are rejected by the database, leasing
returns no work, worker readiness is permanently false, and both legacy executors throw on startup.

Production Work requires a deliberate replacement, not a feature-flag flip. The implementation must:

1. make `agent_jobs` the single canonical run aggregate and retire the parallel `agent_runs` runtime;
2. add transactional command, lease, checkpoint, event, approval, accounting, and artifact contracts in
   Supabase;
3. implement an Azure Container Apps worker and isolated browser execution pool;
4. run every reasoning turn through the approved Azure OpenAI-compatible Responses path using the
   `gpt-5.6-sol` deployment and managed identity;
5. make all tools deny-by-default, scoped, audited, cancellable, and approval-aware;
6. add complete operational telemetry, reconciliation, quotas, and release evidence; and
7. remove Cloudflare compute/build deployment and all Lovable-named runtime routes/dependencies before
   release. Cloudflare may remain only as approved DNS/proxy/WAF edge configuration.

No production resource, schema, environment, or feature flag was changed during this investigation.

## 2. Non-negotiable target boundary

| Concern                                                                                    | Final owner                                          | Required boundary                                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Web, orchestration workers, browser workers, reconcilers                                   | Microsoft Azure                                      | Azure Container Apps and Container Apps Jobs only                                          |
| Durable runs, tasks, commands, events, approvals, ownership, accounting, artifact metadata | Supabase Postgres                                    | Authoritative; all state transitions are transactional database RPCs                       |
| Artifact/evidence bytes                                                                    | Supabase Storage                                     | Private buckets; immutable object keys and database hashes                                 |
| Model execution                                                                            | Approved Azure/OpenAI-compatible provider            | Managed identity; Work is pinned to the Azure deployment for `gpt-5.6-sol`                 |
| Secrets                                                                                    | Azure Key Vault                                      | Versioned references through managed identity; never browser or database payloads          |
| Metrics, traces, logs, alerting                                                            | Azure Monitor / Application Insights / Log Analytics | OpenTelemetry correlation across web, worker, model, tool, and database calls              |
| DNS/edge                                                                                   | Cloudflare                                           | DNS, TLS proxy, approved WAF/rate-limit rules only; no Workers/Pages/build/webhook/runtime |
| Lovable                                                                                    | None                                                 | No runtime, gateway, SDK, hosting, build, webhook, route, or execution dependency          |

Supabase is the source of truth even if an Azure wake-up mechanism is later added. A Service Bus message
may only carry a run ID and revision as an at-least-once hint; it must never be the authoritative queue,
and the worker must always acquire work with the Supabase lease RPC.

## 3. Current-state findings

### 3.1 Work UI and server functions

The `/work` route correctly labels every non-terminal record as execution unavailable, provides no run
creation surface, and permits only cancellation for active historical rows. It reads:

- `agent_jobs` and `agent_job_events`;
- `agent_specialist_tasks` and `agent_dependency_edges`;
- `agent_approvals` and `agent_deliverables`; and
- evidence images from the private `agent-evidence` bucket through five-minute signed URLs.

It does **not** subscribe to Realtime state changes; refresh/detail loading is request-driven. Event reads
are capped at 1,000 without cursor pagination. Errors from tasks, edges, preferences, and approvals are
silently converted to empty arrays, which can make incomplete state look authoritative. There is no
create, pause, resume, retry, approval grant/edit, per-task control, usage/cost view, checkpoint view,
structured failure explanation, or terminal result view. The graph's `progress` concept from the legacy
schema is deliberately not used, which is correct until progress is backed by durable milestones.

Deliverable CRUD exists, including revisions and signed downloads, but current mutations are spread
across application queries rather than one atomic domain RPC. Integrity hashes are displayed/stored but
downloads are not re-hashed by the application. Evidence is an event payload convention rather than a
first-class, queryable evidence record.

### 3.2 Two incompatible runtime families

There are two independent models:

| Legacy family                                 | Work family                          |
| --------------------------------------------- | ------------------------------------ |
| `agent_runs`                                  | `agent_jobs`                         |
| `agent_run_tasks`                             | `agent_specialist_tasks`             |
| `agent_run_events`                            | `agent_job_events`                   |
| API/team server code can create and mutate it | Work UI reads it                     |
| legacy executors are hard-disabled            | canonical lease RPC is hard-disabled |

The schemas have different status names, task identifiers, event envelopes, ownership checks, approval
models, and foreign-key roots. The team API can still write legacy queued records that no worker can
execute and that the Work UI does not display. Pause/resume/retry in legacy server code are multi-query
updates and therefore not atomic. This is the largest correctness risk and must be removed before any
execution enablement.

**Decision:** `agent_jobs` is canonical. Do not try to operate both families. Freeze legacy ingress,
backfill historical legacy runs into canonical read-only history where useful, then rename/archive or
drop the legacy tables only after retention and rollback windows expire.

### 3.3 Canonical schema is intentionally fail-closed

The Helios schema has useful foundations: owner-linked jobs, worker leases, job events, approvals,
notifications, deliverables, private storage, attempts, and indexes. Later compatibility SQL intentionally:

- rejects every insert or update of `agent_jobs.kind`;
- makes the authenticated insert policy always false;
- makes `lease_agent_job` return no rows;
- makes completion throw;
- converts heartbeats, failures, releases, and expired leases to cancellation;
- accepts cancellation but no pause/resume/retry; and
- accepts approval denial but no approval grant.

This is safe but cannot be enabled piecemeal. The existing functions must be replaced together in one
forward migration after worker code and contract tests exist. Editing historical migrations is forbidden.

`agent_specialist_tasks` and dependency edges are structurally closer to the desired graph, but their
ready-task helper only answers readiness; it does not atomically lease a task, fence stale workers, or
advance the aggregate. Task/event ownership is duplicated and can drift without composite foreign keys
or triggers. Event payloads and types have no bounded schema. There is no event idempotency key or
aggregate sequence, so retries can duplicate or reorder user-visible history.

### 3.4 Workers and browser runtime

The shipped worker is only an HTTP health shell. `/healthz` returns 200 while `/readyz` permanently
returns 503 with `execution_enabled: false`. It does not connect to Supabase, lease a job, heartbeat,
invoke a model, execute a tool, persist an event, checkpoint, reconcile, or settle accounting. The legacy
team and browser worker files immediately throw.

A reusable Playwright library exists with per-session browser processes, owner checks, permissions,
private-network hostname blocking, in-memory session tracking, local-disk screenshots, and an in-memory
audit sink. It is not wired to Work. Before production it still needs:

- DNS resolution and redirect-hop SSRF enforcement (hostname string checks do not stop DNS rebinding);
- egress control at the Azure subnet/firewall layer;
- request interception for every navigation/subresource/WebSocket/download;
- upload/download policy, byte/time limits, malware scanning, and content-type verification;
- durable Supabase audit/evidence sinks instead of memory/local disk;
- credential injection from scoped connector handles without exposing tokens to prompts or events;
- popup, dialog, clipboard, geolocation, camera, microphone, extension, and service-worker policy;
- deterministic teardown on lease loss/cancel and resource quotas per session; and
- a browser image with pinned Playwright/browser digests and provenance/SBOM verification.

### 3.5 Model/provider and accounting

The web runtime already has a strong Azure-compatible provider abstraction: validated Azure endpoints,
managed-identity token acquisition, Azure deployment-name translation, Responses compatibility, timeouts,
capability checks, and centralized accounting. Model configuration maps the premium/deep role to
`gpt-5.6-sol`, and Azure Bicep exposes a deep deployment name.

That code is not used by any Work worker. Work must not inherit the direct `OPENAI_API_KEY` fallback.
Its worker startup contract must require `AZURE_OPENAI_ENDPOINT`, managed identity, and a non-placeholder
`AZURE_OPENAI_DEPLOYMENT_WORK_SOL`; reject API-key/direct-provider fallback; and verify the deployment in
a staging canary. Persist both logical model (`gpt-5.6-sol`) and provider deployment/revision in each model
attempt without storing chain-of-thought.

The `ai_usage_events` reservation/finalization flow is request-oriented and useful, but leases expire in
roughly request time. Long-running Work needs run-, task-, and model-attempt attribution, periodic budget
reservation, reconciliation after process death, tool/compute/storage cost, and immutable settlement.
Current model prices are configuration assumptions and need an operator-owned, effective-dated price
catalog rather than hard-coded estimates as a billing source.

### 3.6 Azure, Cloudflare, Lovable, and release state

Current Azure Bicep provisions only the web Container App plus Application Insights/Log Analytics and
access to ACR, Key Vault, and Azure OpenAI. There is no Work worker app, browser pool, scheduled lease
reconciler, workload profile separation, private networking, egress firewall, autoscaling signal, worker
identity, worker-specific Key Vault scope, dashboards, alerts, or dead-letter operational path.

The repository still defaults its production build to a Cloudflare module, depends on the Cloudflare Vite
plugin, contains Wrangler configuration, and has staging/production Wrangler deployment workflows. That
violates the target architecture even if Azure web Bicep also exists. It also retains Lovable-named HTTP
tombstone routes and route-tree entries. Returning `410 Gone` is safe migration behavior, but a deployed
Lovable-named route is still a runtime surface and fails the stated zero-Lovable requirement.

## 4. Canonical Supabase domain design

### 4.1 Aggregate and new/changed records

Create a forward-only migration, provisionally `*_work_runtime_v1.sql`, with these contracts. Preserve
existing UUIDs and historical rows.

#### `agent_jobs` (aggregate root)

Add/standardize:

- `objective text`, `workspace_id uuid`, `idempotency_key text`, and unique
  `(owner_id,idempotency_key)`;
- `status`: `queued | planning | running | approval_required | pausing | paused | retry_wait |
cancelling | completed | failed | cancelled`;
- `desired_state`: `running | paused | cancelled` so commands and worker observation cannot race;
- `state_version bigint default 0`, incremented on every transition for optimistic concurrency;
- `lease_token uuid`, `worker_id`, `lease_expires_at`, `last_heartbeat_at` for fencing;
- `checkpoint jsonb`, `checkpoint_version integer`, `current_task_id uuid`;
- `policy_snapshot jsonb`, `tool_policy_version`, `model_policy_version`, `model_logical_id`;
- `failure_code`, `failure_retryable`, redacted `failure_summary` (replace free-form `error` writes);
- `retry_of_job_id`, `root_job_id`, `next_retry_at`, `cancel_requested_at`, `paused_at`;
- budget fields: `reserved_cost_usd`, `settled_cost_usd`, token and wall-clock ceilings; and
- retention fields: `expires_at`, `purge_after`, `legal_hold`.

Keep `result` bounded to safe summary/manifest metadata. Large outputs belong in deliverables.

#### `agent_specialist_tasks` (canonical tasks)

Use UUID task IDs throughout; eliminate free-form specialist IDs in foreign references. Add
`state_version`, `lease_token`, lease timestamps, `idempotency_key`, `checkpoint`, `result_manifest`,
`failure_code`, `retryable`, `next_retry_at`, `model_attempt_count`, and resource ceilings. Add unique
`(run_id,specialist_key)`, composite `(run_id,id,owner_id)` keys, and status/availability/lease indexes.

#### `agent_dependency_edges`

Enforce same-run source/destination with composite foreign keys; prohibit self-edges; validate acyclicity
inside the graph-finalization transaction; make edges immutable once planning completes. Conditional edges
must reference a versioned, non-code condition DSL—never arbitrary SQL or JavaScript.

#### Events

Keep `agent_job_events` as the public/audit timeline. Add:

- `sequence bigint not null` unique per job, allocated while locking the aggregate;
- `event_key uuid` unique for idempotent append;
- `task_id`, `attempt_id`, `trace_id`, `schema_version`, `visibility`, and `redaction_class`;
- a constrained `event_type` vocabulary; and
- payload byte limits and a JSON validation trigger.

Do not dual-write `agent_run_events`. Never persist prompts, hidden reasoning, credentials, raw headers,
cookies, or arbitrary page content in events. Store user-safe summaries and evidence references only.

#### Commands and attempts

Add `agent_job_commands` for idempotent user/operator commands (`pause`, `resume`, `cancel`, `retry`) with
requester, expected version, status, requested/processed timestamps, and result. Add
`agent_task_attempts` for every execution attempt, fenced lease token, worker/build/model attribution,
start/end/heartbeat, token usage, provider request ID, safe failure, and trace ID.

#### Approvals

Extend `agent_approvals` with `expires_at`, `state_version`, `request_hash`, `tool_call_id`, immutable
redacted preview, editable-field schema, decision actor, decision reason, and single-use `consumed_at`.
Approval creates a checkpoint and releases the task lease. Approval never authorizes a changed request:
edits produce a new hash and a new approval. Expired/denied approvals settle deterministically.

#### Evidence, artifacts, and deliverables

Add first-class `agent_evidence` metadata: owner/job/task/attempt IDs, private bucket/key, media type, bytes,
SHA-256, capture source/time, redaction status, retention, and immutable provenance. `agent_deliverables`
references an immutable artifact version rather than trusting a path string. Add an `agent_artifacts`
manifest with upload state (`pending | verified | ready | quarantined | deleted`), checksum, scanner result,
and encryption/retention metadata.

Upload bytes to a unique owner/job/attempt path, hash while streaming, finalize metadata transactionally,
and expose only short-lived owner-authorized signed URLs. A database row without a verified object is not
a deliverable; an orphan sweeper removes uncommitted objects.

### 4.2 Required transactional RPCs

All are `SECURITY DEFINER SET search_path=public,pg_temp`, explicitly revoked from `public/anon`; worker
RPCs are service-role only until a narrower Supabase worker role is available.

1. `create_agent_job(...)` — authenticated owner, entitlement/quota/idempotency validation, inserts job
   plus initial event atomically.
2. `command_agent_job(job_id, command, expected_version, command_key)` — owner validation and legal
   desired-state transition; cancellation always wins.
3. `decide_agent_approval(id, decision, expected_version, request_hash)` — owner-only CAS decision.
4. `lease_agent_job(worker_id, capabilities, lease_seconds)` — `FOR UPDATE SKIP LOCKED`, eligibility and
   concurrency checks, increments attempts, issues a random fencing token, appends leased event.
5. `heartbeat_agent_job(job_id, lease_token, checkpoint, usage_delta)` — accepts only the current token,
   renews within bounds, returns desired state.
6. `lease_ready_agent_task(job_id, job_lease_token, capabilities)` — dependency-safe atomic task lease.
7. `checkpoint_agent_task(...)`, `request_agent_approval(...)`, and `settle_agent_task(...)` — fenced,
   idempotent, event-appending transitions.
8. `settle_agent_job(...)` — derives terminal state from tasks and desired state; never trusts a worker's
   arbitrary aggregate status.
9. `recover_expired_agent_leases(batch_size)` — retries with bounded exponential backoff/jitter or fails
   exhausted work; never silently cancels.
10. `reconcile_agent_artifacts(...)` and `reconcile_agent_accounting(...)` — bounded, idempotent repair.

Each mutation locks the job, checks `state_version` and lease token, changes state, and appends the next
sequenced event in one transaction. Workers must treat a fencing failure as immediate lease loss.

### 4.3 RLS and grants

- Authenticated users get `SELECT` on their jobs, tasks, edges, safe events, approvals, evidence,
  artifacts, deliverables, commands, and their summarized usage.
- Users get no direct `INSERT/UPDATE/DELETE` on execution records; all commands use RPCs.
- Deliverable rename/move/delete/restore also moves to owner-checking RPCs. Project moves validate current
  owner/editor membership.
- `owner_id` is derived from `auth.uid()` in user RPCs and from the parent row in worker RPCs, never from
  caller input.
- Child policies use `EXISTS` against the owned parent. Composite foreign keys/triggers prevent owner
  drift. Worker tables and unsafe/internal event payloads have no authenticated grants.
- Storage policies require bucket, first path segment `auth.uid()`, and an owned ready metadata record;
  writes occur server-side only. Signed URL creation rechecks ownership and artifact state.
- Add two-user, project-member, revoked-member, service-role, expired-token, object-path traversal, and
  RPC-grant tests to the release RLS matrix.

## 5. Azure execution design

### 5.1 Components

1. **Web Container App:** Node/TanStack app only; creates/commands jobs via authenticated RPCs and reads
   Supabase. No service-role use in browser code.
2. **Orchestrator Worker Container App:** private ingress disabled, minimum two production replicas across
   zones, controlled concurrency. Polls the lease RPC with jitter, plans/executes non-browser tasks,
   heartbeats, and checkpoints. Graceful shutdown stops leasing, sets worker draining, checkpoints, then
   releases only if still fenced.
3. **Browser Worker Container App/pool:** separate identity, image, subnet/workload profile, CPU/memory and
   egress policy. One job/session per sandbox. It receives only an opaque task lease and scoped connector
   handles. It writes evidence to Supabase and exits after teardown.
4. **Reconciler Container Apps Jobs:** scheduled lease recovery, approval expiry, accounting settlement,
   artifact orphan cleanup, retention purge, and worker-liveness reconciliation. Every run is bounded and
   safe to overlap.
5. **ACR:** immutable digest deployment, signed provenance, SBOM and vulnerability gate.
6. **Key Vault:** separate web/orchestrator/browser identities and least-privilege secret access. Prefer
   managed identity for Azure OpenAI; rotate Supabase service role and connector encryption keys.
7. **Azure Monitor:** Application Insights, Log Analytics, workbooks, action groups, metric alerts, and
   availability tests.

The first release should use Supabase polling with `SKIP LOCKED`; it is simpler and preserves the stated
authority. Configure min replicas so polling never scales to zero. Add a non-authoritative Azure Service
Bus wake-up hint only after load tests demonstrate a latency/cost need, with duplicate/lost-message tests.

### 5.2 Network and identity

- VNet-integrate worker environments. Route browser egress through Azure Firewall/NAT with DNS proxy;
  deny metadata, RFC1918, link-local, Azure control-plane, Supabase admin, and Key Vault destinations from
  the browser sandbox except explicit service endpoints needed by its broker.
- Give orchestrator identity Azure OpenAI User and its exact Key Vault secret set. Browser identity must
  not have Azure OpenAI or general Key Vault access.
- Use TLS everywhere; validate Supabase/Azure host allowlists. No inbound public worker endpoint.
- Container filesystem is ephemeral/non-authoritative and read-only where possible; `/tmp` has a quota.

### 5.3 GPT-5.6 Sol execution contract

The Work model adapter is server-only and must call the approved Azure OpenAI-compatible Responses API.
It sends a versioned system/tool policy and structured task context, requests structured plan/tool-call
outputs, validates every output with JSON Schema, and caps input, output, reasoning effort, tools, turns,
wall time, and cost. It must support provider request IDs, timeout/abort propagation, retry classification,
and usage extraction. Provider retries use idempotency keys where supported; otherwise uncertainty is
recorded and non-idempotent tool actions are never replayed automatically.

No hidden chain-of-thought is stored or shown. Persist only concise reasoning summaries explicitly
produced for users, tool intents/results after redaction, citations/evidence, and usage metadata.

## 6. Orchestration and lifecycle semantics

### 6.1 State machine

- `queued -> planning -> running -> completed` is the happy path.
- `running -> approval_required -> queued/running` releases compute while waiting.
- Pause sets `desired_state=paused`; a cooperative worker checkpoints and moves through `pausing` to
  `paused`. Resume returns to `queued` from the last durable checkpoint.
- Cancel sets `desired_state=cancelled` immediately. Workers abort model calls and tools, checkpoint safe
  cleanup state, and settle `cancelled`. A reconciler force-settles after a deadline. Cancellation wins
  over completion if requested before the terminal transaction locks the job.
- Retry never rewrites history. A task retry creates a new attempt. A terminal-run retry creates a new
  job linked by `retry_of_job_id`, copying only validated policy/input/checkpoint references.
- Retry only transient provider/network/lease failures automatically. Auth, policy, invalid input,
  approval denial, budget exhaustion, and deterministic tool failures require user/operator action.
- Backoff is exponential with jitter and a maximum time/attempt ceiling. Exhaustion becomes a safe,
  classified failure.

### 6.2 Planner and specialist loop

1. Lease job and reserve run budget.
2. Ask Sol for a bounded DAG plan; validate roles, tools, acyclicity, fan-out, depth, and budget.
3. Persist the complete plan and edges atomically before execution.
4. Lease ready tasks up to policy parallelism.
5. For each turn: reload desired state and policy, reserve model budget, call Sol, validate output, append
   safe event, authorize/approve tool, execute with idempotency, persist observation/evidence, checkpoint,
   settle accounting, and continue within turn limits.
6. A reviewer task validates deliverables and evidence. Job settlement derives the aggregate result.

Context is rehydrated from Supabase at every attempt; process memory is only a cache. Never hold a
database transaction open across a model or tool call.

## 7. Tool permission and approval model

Define a versioned registry for every tool: input/output schema, required capability, risk, read/write
classification, idempotency behavior, timeout, result byte cap, redactor, allowed destinations, and
approval rule. The effective policy is the intersection of platform, plan, workspace/project, user,
connector scopes, and run snapshot. Unknown tools or fields deny.

- Read-only search/fetch can be auto-approved only for public allowed destinations.
- Browser navigation is read-like but still passes URL/DNS/redirect/subresource controls.
- External writes, messages, purchases, publishing, destructive actions, auth changes, uploads, secrets,
  and code execution require explicit preview approval or are unsupported in v1.
- Approval previews name destination, account, exact effect, shared fields, reversibility, and expiry.
- Tool credentials stay in an Azure-side broker/connector module, never model context.
- Every call has `tool_call_id` and idempotency key. Retrying an unknown-result non-idempotent call pauses
  for reconciliation rather than invoking twice.
- Shell/code execution should be excluded from v1. When introduced, use disposable Azure sandboxes with
  no credentials, no host mounts, restricted egress, syscall/cgroup limits, and artifact-only output.

## 8. Observability, SLOs, and accounting

Propagate W3C `traceparent` from create command through job/task/attempt/model/tool/artifact operations.
Structured logs include environment, build digest, job/task/attempt IDs, lease token **hash**, worker ID,
event type, duration, retry class, and provider request ID. They exclude content, URLs with query strings,
tokens, credentials, cookies, user prompts, and evidence bytes.

Minimum metrics:

- queue depth/oldest age, lease latency, active/expired leases, heartbeat lag;
- run/task throughput and duration by terminal/failure class;
- approval wait/expiry/denial, cancel acknowledgement and settlement latency;
- model latency/tokens/cost/rate-limit/error by deployment and attempt;
- tool latency/errors/unknown outcomes, browser starts/crashes/resource use;
- artifact upload/verify/orphan failures and storage bytes; and
- accounting reservation/finalization drift and per-plan budget rejection.

Initial release SLOs must be approved before load testing: API availability, p95 queue-to-lease,
heartbeat freshness, cancellation acknowledgement/settlement, event visibility, and terminal accounting
settlement. Alert on oldest queued age, lease-expiry spikes, no ready workers, repeated task failure,
provider error/rate-limit budgets, accounting drift, orphan growth, browser crash rate, and daily cost.

Accounting flow: reserve worst-case tokens/cost before each model call; record Azure usage and latency;
atomically finalize the attempt; add Azure compute duration, browser duration, storage, search/connector
cost; roll up to task/job/user/billing period; reconcile stale reservations. User-visible cost is labelled
estimated until reconciled. Enforce per-turn, per-task, per-run, daily, monthly, concurrency, and premium
model quotas fail-closed.

## 9. Work UI production changes

Only after backend staging gates pass:

- Add an idempotent create flow with objective, project/context, allowed tools, budget, and approval policy.
- Replace the unavailable banner with runtime health only when the authenticated create canary passes;
  retain truthful degraded/paused messaging.
- Subscribe to authorized Supabase Realtime changes, but always refetch by cursor/version after reconnect.
- Cursor-paginate sequenced events and clearly mark redacted/internal events.
- Add pause/resume/cancel/retry controls driven by legal server-returned transitions and optimistic version;
  show command pending/accepted/settled separately.
- Add approval preview/edit/deny/approve with expiry and request hash.
- Show checkpoints, attempt history, classified errors, next retry, worker-independent status, real token/cost
  usage, evidence provenance, artifact verification, and checksum.
- Never show a percentage unless backed by completed weighted milestones. Preserve accessible live regions,
  keyboard graph controls, mobile behavior, empty/error/loading states, and reduced-motion support.

## 10. Zero-Lovable and Cloudflare-only-edge exit work

Before a Work release candidate:

1. change the production build to the Node/Azure target unconditionally;
2. remove `@cloudflare/vite-plugin`, Wrangler config, Cloudflare deploy workflows, generated Worker output,
   and Cloudflare runtime environment assumptions;
3. deploy the web image only through the Azure image-digest pipeline;
4. remove all `/.lovable/*` and `/lovable/*` source routes and regenerate the route tree; handle any
   temporary retirement response at approved Cloudflare edge configuration, not application runtime;
5. delete/rename Lovable runtime helpers and remove Lovable environment/secrets/webhook references;
6. add a strict repository and built-image scan that rejects Lovable SDK/host/import/route/webhook and
   Cloudflare Workers/Pages packages/config/bindings; and
7. retain Cloudflare only in separately reviewed DNS/WAF/TLS documentation/IaC with no application build
   credentials.

Historical prose may mention the migration only if the strict scan has an explicit documentation-only
allowlist. The lockfile and final container SBOM must be clean, not merely source imports.

## 11. Implementation sequence and acceptance gates

### Phase 0 — contract freeze (P0)

- Disable/remove legacy team creation API and document `agent_jobs` as canonical.
- Write state-machine, event vocabulary, tool registry, redaction, retention, and failure taxonomy specs.
- Add migration/RPC contract tests and a local two-principal Supabase harness.

**Exit:** no reachable path creates `agent_runs`; architecture/security review approves the contracts.

### Phase 1 — durable control plane (P0)

- Add canonical schema, RLS, commands, fencing leases, checkpoints, events, approval, attempts, evidence,
  artifact manifests, and accounting attribution in forward migrations.
- Backfill representative legacy history and prove rollback/restore.
- Implement API/server functions against RPCs only.

**Exit:** database concurrency/property tests prove no double lease, stale settlement, illegal transition,
cross-owner access, duplicate command/event, or dependency escape.

### Phase 2 — Azure orchestrator and Sol (P0)

- Build worker loop, graceful drain, model adapter, structured planner, quotas, and reconciliation jobs.
- Extend staging/production Bicep for separate identities/apps/jobs/network/telemetry.
- Pin, sign, scan, and attest images.

**Exit:** staging canary executes a no-tool run through Azure `gpt-5.6-sol`, survives worker kill/lease
recovery, settles exact events/usage, and leaves no secret/content in logs.

### Phase 3 — safe tools and browser (P0 for browser launch)

- Implement tool registry/broker, approvals, durable audit sink, SSRF/egress controls, immutable evidence,
  browser isolation and teardown.
- Chaos-test DNS rebinding, redirects, popup/subresource escape, cancel during navigation/upload, browser
  crash, duplicate calls, storage failure, and connector revocation.

**Exit:** independent security review and adversarial test suite pass; unknown-result writes cannot replay.

### Phase 4 — UI and operational readiness (P1)

- Enable create/live controls behind an Azure-managed server feature flag for internal staging users.
- Add dashboards, alerts, on-call runbooks, cost budgets, support tooling, data export/deletion, and DR.
- Complete accessibility, browser, load, soak, failure, and two-user tests.

**Exit:** 72-hour staging soak, approved SLO/error budgets, zero high/critical vulnerabilities, reconciled
accounting, restore exercise, cancellation SLA, and release evidence bundle all pass.

### Phase 5 — release (P1)

- Complete zero-Lovable/Cloudflare-runtime removal.
- Use immutable Azure revisions: internal -> 1% -> 10% -> 50% -> 100%, with automated rollback thresholds.
- Start with low concurrency, read-only tools, tight budgets, and explicit approvals.

**Exit:** production canary and each ramp observation window pass. The kill switch stops new leases while
preserving reads, cancellation, checkpoints, and reconciliation.

## 12. Required test and release evidence matrix

| Area          | Required evidence                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Schema        | Fresh apply, production-baseline apply, rollback/restore, generated types, schema contract     |
| Concurrency   | 100+ parallel leasers, fencing, heartbeat race, cancel/complete race, duplicate commands       |
| RLS           | owner A/B, anon, project roles/revocation, service role, storage paths/signed URLs             |
| Lifecycle     | create, pause, resume, cancel each phase, transient/permanent retry, approval expiry/deny/edit |
| Recovery      | SIGTERM/SIGKILL, OOM, network partition, Supabase outage, Azure OpenAI timeout/429/5xx         |
| Model         | exact Azure deployment, managed identity only, schema-invalid response, usage reconciliation   |
| Tools/browser | SSRF/DNS rebinding/redirects, egress, injection, secrets, idempotency, sandbox cleanup         |
| Artifacts     | hash mismatch, MIME spoof, partial/orphan upload, malware quarantine, retention/deletion       |
| Observability | trace correlation, dashboard queries, alert firing, log redaction/secret canaries              |
| Performance   | queue/load/soak at 2x forecast, DB connection budget, browser capacity, provider limits        |
| Supply chain  | locked deps, SBOM, signatures/attestations, vulnerability/license scan, digest deploy          |
| Architecture  | Azure-only runtime/build/deploy; Supabase authority; Cloudflare edge-only; zero Lovable        |
| UX            | truthful states, reconnect/pagination, accessibility, responsive browser matrix, screenshots   |

Production enablement requires signed evidence for every row, migration hashes matching the deployed
Supabase project, Azure resource export matching reviewed Bicep, immutable image digests, staging provider
request evidence, and named security/operations/product approvals. Source-only tests are insufficient.

## 13. Definition of done

KovaGPT Work is production-ready only when a user-authorized job is durably created in Supabase, leased
exactly once at a time by a fenced Azure worker, planned and executed through the approved Azure
`gpt-5.6-sol` deployment, safely invokes only policy-approved tools, produces immutable verified evidence
and deliverables in Supabase, survives process/resource failure from checkpoints, responds correctly to
pause/resume/cancel/retry/approval, reconciles usage and cost, exposes complete redacted telemetry, passes
all staging/release gates, and has no Lovable or Cloudflare compute/build/runtime dependency.

Until then, keep the existing unavailable UI, database insert trigger, empty lease RPC, worker readiness
failure, and generation flags fail-closed.

## Appendix A — inspected implementation anchors

- Work UI and server facade: `src/routes/work.tsx`, `src/lib/work.functions.ts`
- Canonical disabled runtime: `supabase/migrations/20260728090000_helios_agent_runtime.sql`,
  `supabase/migrations/20260801235959_agent_runtime_event_schema_compatibility.sql`
- Canonical graph/deliverables: `supabase/migrations/20260728120000_zenith_work_graph.sql`,
  `supabase/migrations/20260728150000_forge_deliverable_resources.sql`
- Legacy runtime: `supabase/migrations/20260727210000_constellation_connectors_agents.sql`,
  `supabase/migrations/20260727230000_apollo_agent_graphs.sql`, `src/agents/team.server.ts`,
  `src/agents/execution.server.ts`, `src/routes/api/agents/runs.ts`
- Disabled workers: `worker/src/index.mjs`, `workers/agent-team-worker.mjs`,
  `workers/browser-agent.mjs`
- Browser library: `src/browser-runtime/*`
- Provider/model/accounting: `src/lib/ai/provider.server.ts`, `src/lib/ai/model-config.mjs`,
  `src/lib/ai/accounting.server.ts`, `supabase/migrations/20260803130000_ai_usage_accounting.sql`,
  `supabase/migrations/20260820220000_ai_accounting_canonicalization.sql`
- Azure/web/edge: `infra/azure/staging/main.bicep`, `infra/azure/production/main.bicep`,
  `vite.config.ts`, `wrangler.jsonc`, `.github/workflows/deploy-cloudflare-production.yml`
