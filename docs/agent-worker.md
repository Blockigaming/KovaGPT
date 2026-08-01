# Agent worker operations

The supported Helios worker processes `agent_jobs` with `kind = 'team'`. Queue leasing is atomic,
bounded, retryable, and recovered after lease expiry. Its service-role credential must be injected
only into the worker.

Browser automation is not currently available. The browser-run API returns
`browser_agent_unavailable` with HTTP 503, the user interface does not offer a working start
control, and the legacy `workers/browser-agent.mjs` entry point exits immediately. Existing
browser rows are preserved for operator review but are never leased by Helios.

The legacy `workers/agent-team-worker.mjs` entry point also exits immediately. Team execution is
supported only through `worker/src/index.mjs` and the `agent_jobs` lease RPC contract.

Constellation `agent_runs` events and Helios `agent_jobs` events intentionally use separate
tables:

- `agent_run_events(run_id, kind, safe_payload)` remains unchanged.
- `agent_job_events(job_id, event_type, payload)` is used by Helios.

## Local development

```bash
npm ci --no-audit --no-fund
npx supabase start
npm run db:migrate
npm run dev
npm run worker:dev
curl --fail http://localhost:8788/readyz
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER_URL`, and
`AI_PROVIDER_API_KEY`. The worker refuses to start without its Supabase credentials, and team
jobs fail truthfully when the AI provider is not configured or returns an error.

## Container deployment

```bash
docker compose -f docker-compose.agent.yml build agent-worker
docker compose -f docker-compose.agent.yml up -d agent-worker
docker compose -f docker-compose.agent.yml exec agent-worker node worker/scripts/health-check.mjs
```

Configure concurrency, polling, lease duration, and identity with environment variables.
Schedulers should probe `/healthz` for liveness and `/readyz` for readiness and send
`SIGTERM` during shutdown.

## Smoke test

Set `AGENT_WORKER_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`, then run
`npm run worker:smoke`. This is a read-only readiness and schema-contract check. It does not
enqueue a job, call an AI provider, create a user, or modify production data.
