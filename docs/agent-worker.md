# Agent runtime status

KovaGPT does not currently provide browser or agent-team execution. The historical schemas and
records remain available for owner-scoped viewing, cancellation, denial, and cleanup, but new jobs
are rejected and no job can be leased.

This is deliberate fail-closed behavior. The previous entry points used incompatible queues and
did not provide one end-to-end contract from user request through plan execution, approvals,
evidence, polling, and results.

## Event schema compatibility

Constellation and Helios use separate event tables:

- `agent_run_events(run_id, kind, safe_payload)` remains unchanged.
- `agent_job_events(job_id, event_type, payload)` stores historical Helios job events.

The compatibility migration creates the second table without renaming, copying, updating,
truncating, or deleting existing event rows.

## Fail-closed controls

- Both `/api/agents/runs` and `/api/agents/teams` return HTTP 503 for creation and drain
  unread request bodies.
- The Work and Agent workspace interfaces show execution as unavailable.
- New `agent_jobs` inserts are rejected for authenticated and service-role callers; the legacy
  `agent_runs` team path also cannot enqueue.
- `lease_agent_job` returns no rows.
- Historical active jobs can be cancelled; paused jobs cannot be resumed or retried.
- Pending approvals can be denied but cannot be approved into an unavailable runtime.
- `workers/browser-agent.mjs` and `workers/agent-team-worker.mjs` exit immediately.

## Diagnostic process

`worker/src/index.mjs` is a diagnostic process, not an execution worker. It exposes:

- `/healthz`: HTTP 200 while the process is alive.
- `/readyz`: HTTP 503 with `execution_enabled: false`.

No Supabase service-role or AI-provider credential should be injected into this process.

```bash
npm run worker:dev
curl --fail http://localhost:8788/healthz
curl --fail-with-body http://localhost:8788/readyz # expected HTTP 503
```

The Compose health check intentionally uses `/readyz`, so the disabled runtime cannot be mistaken
for an execution-ready deployment.

## Read-only smoke check

Set `AGENT_WORKER_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`, then run
`npm run worker:smoke`. It verifies the fail-closed readiness response and both event schemas. It
does not enqueue a job, call an AI provider, create a user, or modify data.

Browser or team execution must remain unavailable until one unified runtime (not both legacy
queues) has executable tests proving queue creation, ownership, bounded inputs and outputs,
redirect/network policy, approval consumption, queued prompts and user questions, evidence storage,
cancellation, background resume/recovery, notification delivery, retry semantics, and truthful
client polling.
