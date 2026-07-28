# Agent worker operations

The Helios worker is one runtime for browser and agent-team jobs. Queue leasing is atomic, bounded, retryable, and recovered after lease expiry. Its service-role credential must be injected only into the worker.

## Local development

```bash
npm ci --no-audit --no-fund
npx supabase start
npm run db:migrate
npm run dev
npm run worker:dev
curl --fail http://localhost:8788/readyz
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and an `AI_PROVIDER_URL` plus `AI_PROVIDER_API_KEY`. Install Chromium with `npx playwright install --with-deps chromium` when not using Docker.

## Container deployment

```bash
docker compose -f docker-compose.agent.yml build agent-worker
docker compose -f docker-compose.agent.yml up -d agent-worker
docker compose -f docker-compose.agent.yml exec agent-worker node worker/scripts/health-check.mjs
```

The image supplies Playwright Chromium and runs as `pwuser`. Configure concurrency, polling, lease duration, identity, memory, and temporary storage with the environment and Compose limits. Kubernetes or other schedulers should probe `/healthz` for liveness and `/readyz` for readiness, send `SIGTERM`, and provide a writable ephemeral `/tmp/kova-agent`.

## Smoke test

With local Supabase and the worker running, set `WORKER_SMOKE_EMAIL` and `WORKER_SMOKE_PASSWORD`, then run `npm run worker:smoke`. It uses only `https://example.com/`, validates the stored screenshot hash and textual result, removes evidence, and verifies a second paused run can be cancelled.
