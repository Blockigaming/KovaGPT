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
after the bounded attempt count. Provider Retry-After windows are persisted in `email_send_state`
for every replica and also extend the claimed row lease. Startup rejects any batch/concurrency/
request-timeout combination whose worst-case sequential waves exceed the configured lease.
Expired messages are never sent.

No recipient, subject, HTML, text, API key, or service-role key is written to process logs. Logs use
queue/message identifiers and stable error codes.

## Required secrets and configuration

- `SUPABASE_URL`: production project origin (HTTPS).
- `SUPABASE_SERVICE_ROLE_KEY`: server-only queue/table access.
- `RESEND_API_KEY`: server-only Resend sending key.
- `KOVA_EMAIL_QUEUE_ENABLED=true`: explicit queue producer and worker execution gate.
- `EMAIL_SENDER_DOMAINS=notify.kovagpt.com`: verified sender-domain allowlist.
- `KOVA_PUBLIC_ORIGIN=https://kovagpt.com`: unsubscribe-link origin.

The web application separately requires `RESEND_WEBHOOK_SECRET` to verify delivery events. Do
not copy `RESEND_API_KEY` into the web container; the sender key belongs only to the dedicated
worker.

Optional bounded tuning:

- `EMAIL_WORKER_PORT` (default `8789`)
- `EMAIL_WORKER_POLL_MS` (default `2000`, range 250–60000)
- `EMAIL_WORKER_BATCH_SIZE` (default `10`, range 1–100)
- `EMAIL_WORKER_CONCURRENCY` (default `2`, range 1–10)
- `EMAIL_WORKER_VISIBILITY_TIMEOUT_SECONDS` (default `300`, range 30–900; must cover the validated batch execution budget)
- `EMAIL_WORKER_REQUEST_TIMEOUT_MS` (default `10000`, range 1000–30000)
- `EMAIL_WORKER_MAX_ATTEMPTS` (default `5`, range 1–20)
- `EMAIL_WORKER_AUTH_TTL_MINUTES` (default `15`)
- `EMAIL_WORKER_TRANSACTIONAL_TTL_MINUTES` (default `60`)

## Atomic application producers

Help acknowledgements, Project invitations, and shared-chat invitations render only registered
KovaGPT templates on the server. Project/share mutations carry a client-generated operation UUID
and a server-computed SHA-256 request fingerprint. The collaboration record, tracked send log,
PGMQ message, and immutable operation result commit in one database transaction. An exact transport
retry returns the original result without another row or email; reusing an operation UUID for
different content fails closed. The collaboration RPCs and operation ledger are executable only by
`service_role`, while authenticated callers still pass through ownership checks and distributed
rate limits in the server functions.

## Delivery reconciliation

Configure Resend to send webhooks to `https://kovagpt.com/api/public/email/webhook`. Subscribe to
`email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`,
`email.complained`, and `email.suppressed`. The endpoint verifies the exact raw body with the
Svix delivery id, timestamp, and signature, rejects signatures older than five minutes, and stores the
delivery id as a durable replay key. It matches the signed provider message id to the worker's
authoritative send log; event-supplied recipients and subjects are never trusted. Bounce, complaint,
and provider-suppression events update the send log and suppression list atomically. A webhook that
arrives before the worker records its provider id returns a retryable response instead of losing the
event.

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

Before enabling queue production, apply the reviewed email migrations and verify the queue RPCs are
executable only by `service_role`. The migration unschedules every historical
`process-email-queue` cron entry so the retired Edge Function dispatcher cannot race the dedicated
worker. Deploy the immutable worker revision, wait for its `/readyz` to return 200, configure the
signed webhook, and only then enable the web application's queue producer. Send Resend's safe
delivered, bounced, complained, and suppressed test addresses and verify send-log/DLQ/suppression
behavior. Configuring the Resend API key, verified domain, webhook, and deploying the exact image are
owner/provider actions.

Rollback by setting `KOVA_EMAIL_QUEUE_ENABLED=false` on the worker revision or scaling the dedicated
worker to zero. Queued messages remain durable and invisible leases expire; do not delete queues.
