# Production Kova email worker

The production worker delivers Kova-owned verification/recovery messages and
optional account notices through the existing Resend renderer, durable claims,
prepare checks and idempotency keys. It sends no mail when installed and defaults
off. Both existing staging operator scripts retain their staging-only gates.

## Exact configuration

The app must be `kovagpt-prod-web`, `AZURE_ENVIRONMENT=production`, with both
`KOVA_AUTH_PUBLIC_ORIGIN` and `KOVA_AUTH_ORIGIN` equal to
`https://kovagpt.com`. `SUPABASE_URL` and
`KOVA_EXPECTED_SUPABASE_PROJECT_REF` must identify the production project
`mfbycmbjygcfkrsuepxf`. Both browser and server Auth modes must be qualified
separately; the email worker accepts an explicitly configured `dual` or `kova`
server mode and does not choose or change it.

Required server-only slots are `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and a
dedicated `KOVA_EMAIL_WORKER_SECRET` of at least 32 characters. The worker never
falls back to a shared scheduler credential. Secrets stay in private runtime or
operator bindings; do not put them in commands, files, browser configuration or
receipts.

Enable only after the exact forward migration and production target are
qualified:

- `KOVA_PRODUCTION_EMAIL_WORKER_ENABLED=true`
- `KOVA_AUTH_EMAIL_DISPATCH_ENABLED=true` and `KOVA_EMAIL_QUEUE_ENABLED=true`
- `KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED=true` for optional account notices

All nine account preferences remain on by default. Saved opt-outs remain
authoritative and are rechecked before dispatch. Verification and requested
password recovery remain operational messages outside optional preferences.

## Invocation contract

An authorized durable scheduler invokes the source-owned entry point
`scripts/auth-email/production-worker.mjs --execute` with its dedicated private
worker secret and `KOVA_EMAIL_WORKER_OPERATOR_ENABLED=true` in its environment.
The entry point sends exactly one signed POST to
`https://kovagpt.com/api/internal/email-dispatch`, with the fixed body `{}`,
one random run UUID and a canonical UTC timestamp. Its HMAC covers the version,
method, path, run ID, timestamp and exact body. Requests older than 60 seconds or
more than 5 seconds in the future fail authentication. There are no redirects,
custom destinations, response-body echoes or automatic invocation retries.

PostgreSQL rejects replayed run IDs and serializes invocations with a 180-second
lease. The database selects at most one current owned Auth message and one
pending account notice; the request cannot supply an account, recipient, event
ID, batch size or deadline. The account selector preserves the existing
24-hour outbox lifetime through a separate worker-only claim, without widening
the staging operator's 15-minute scope. Existing prepare RPCs recheck proof,
expiry, recipient, preferences and suppression before the provider call.

Each invocation attempts at most two provider sends. Auth retries retain their
existing five-attempt limit, backoff and identical provider idempotency key; this
entry point never loops or retries a failed invocation. Account notice
uncertainty retains the existing non-replay behavior. Each remote RPC has an
8-second timeout and provider sends have their existing 10-second timeout.
The operator has a 120-second request deadline. An uncertain completion is
reported as pending, never asserted as delivered.

## Activation and remaining qualification

Installing code or setting a flag does not create a timer or prove email delivery.
An existing authorized durable host, dedicated secret custody, schedule, job
timeout and one observed successful invocation must be established before
automatic delivery can be called working. Current source evidence identifies no
qualified production email scheduler host. A one-minute schedule would attempt
at most one message per lane per minute; capacity, queue lag and failures must be
observed before changing that bound.

Consume Monitoring's current installation/recovery receipts before activation;
do not replay an already verified installer. For the additive new-account first
release, full-project clone/Storage recovery, existing-account adoption and
staging encryption custody are not prerequisites. The required schema contracts
and compatible recovery evidence remain separate from actual runtime bindings,
backend trust, recurring invocation and delivered email. Keep those receipts
private, outside public source.

That first release uses matching browser/server `dual`, preserving existing
hosted Google login. Monitoring coordinates disabling new hosted signup before
exposing owned signup; do not adopt hosted accounts by matching email. Owned
Google is separately gated and need not be enabled for existing hosted Google.

Core sign-in is separate from the unfinished owned-account final-deletion path.
Its existing 503 guard remains unchanged. Pure `kova` mode must not be enabled
until existing hosted principals have supported adoption and the existing
cutover evidence passes. Signing issuer/public trust, original encryption key
custody and backend token/revocation acceptance remain separate live checks.
