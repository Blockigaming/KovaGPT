# Transactional email worker

KovaGPT queues branded application email in Supabase PGMQ. The dedicated email worker is the
source-controlled consumer. It sends through Resend and does not enable the separate, intentionally
disabled browser/agent runtime.

## Runtime

```bash
node worker/src/email-worker.mjs
```

The worker polls only `auth_emails` and `transactional_emails`, validates every envelope, permits
senders only from `EMAIL_SENDER_DOMAINS`, rejects control characters and oversized content, checks
the local suppression table, and requires a pre-existing `email_send_log` record. Provider requests
carry the queue payload's stable Resend `Idempotency-Key`. A provider success is recorded before
the PGMQ row is deleted; if deletion fails, the next lease reconciles the terminal log without
sending again. Retryable failures remain under PGMQ visibility timeout and move to the matching DLQ
after the bounded attempt count. Expired messages are never sent.

No recipient, subject, HTML, text, API key, or service-role key is written to process logs. Logs use
queue/message identifiers and stable error codes.

## Required secrets and configuration

- `SUPABASE_URL`: production project origin (HTTPS).
- `SUPABASE_SERVICE_ROLE_KEY`: server-only queue/table access.
- `RESEND_API_KEY`: server-only Resend sending key.
- `KOVA_EMAIL_QUEUE_ENABLED=true`: explicit execution gate.
- `EMAIL_SENDER_DOMAINS=notify.kovagpt.com`: verified sender-domain allowlist.
- `KOVA_PUBLIC_ORIGIN=https://kovagpt.com`: unsubscribe-link origin.

Optional bounded tuning:

- `EMAIL_WORKER_PORT` (default `8789`)
- `EMAIL_WORKER_POLL_MS` (default `2000`, range 250–60000)
- `EMAIL_WORKER_BATCH_SIZE` (default `10`, range 1–100)
- `EMAIL_WORKER_CONCURRENCY` (default `2`, range 1–10)
- `EMAIL_WORKER_VISIBILITY_TIMEOUT_SECONDS` (default `120`, range 30–900)
- `EMAIL_WORKER_REQUEST_TIMEOUT_MS` (default `10000`, range 1000–30000)
- `EMAIL_WORKER_MAX_ATTEMPTS` (default `5`, range 1–20)
- `EMAIL_WORKER_AUTH_TTL_MINUTES` (default `15`)
- `EMAIL_WORKER_TRANSACTIONAL_TTL_MINUTES` (default `60`)

## Health, readiness, and metrics

- `GET /healthz` proves only that the process is alive.
- `GET /readyz` becomes HTTP 200 only after a successful poll and returns HTTP 503 when polling is
  stale or shutdown has started.
- `GET /metrics` exposes non-sensitive process counters.
- Every other route returns 404 and every non-GET request returns 405.

The existing diagnostic agent worker remains unchanged and unavailable at its own `/readyz`.

## Release and rollback

Build `worker/Dockerfile.email` into an immutable image tied to the reviewed source SHA. Deploy it
as a distinct Azure Container App with one minimum replica and the readiness path above. Inject
secrets through the approved Azure secret store; never bake them into the image or parameters.

Before enabling queue production, apply the reviewed email migrations and verify the four PGMQ RPCs
are executable only by `service_role`. Then send Resend's safe delivered, bounced, complained, and
suppressed test addresses and verify send-log/DLQ/suppression behavior. Configuring the Resend API key,
verified domain, webhook, and deploying the exact image are owner/provider actions.

Rollback by setting `KOVA_EMAIL_QUEUE_ENABLED=false` on the worker revision or scaling the dedicated
worker to zero. Queued messages remain durable and invisible leases expire; do not delete queues.
