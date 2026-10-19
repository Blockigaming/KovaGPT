# Bounded owned-auth staging email delivery

This source-only CLI uses the existing Resend API resource and existing PostgreSQL
queue. It installs no provider, daemon, cron job, Azure resource or dependency.
Installing the migration does not send mail. Execute only the explicitly
authorized message scope; this tool grants no authority for other operations.

The reviewed migration must be installed and its service-only grants verified
before any authorized execution. Run from this repository in a private operator
environment with the already approved staging configuration and secret references.
Do not place keys, recipient lists, queue payloads or action links in Git, chat,
command arguments or shared artifacts.

The CLI defaults to a disabled report. Explicit execution is:

```sh
node scripts/auth-email/dispatch.mjs --execute
```

Execution requires all of these private environment inputs, in addition to
`KOVA_AUTH_MODE=kova` and `KOVA_EMAIL_QUEUE_ENABLED=true`:

- `AZURE_ENVIRONMENT=staging`, `CONTAINER_APP_NAME=ca-kovagpt-staging`, and
  `KOVA_AUTH_EMAIL_DISPATCH_ENABLED=true`.
- `KOVA_AUTH_PUBLIC_ORIGIN` and `KOVA_AUTH_EMAIL_EXPECTED_ORIGIN` equal the exact
  reviewed `ca-kovagpt-staging.*.azurecontainerapps.io` HTTPS origin.
- `SUPABASE_URL` and `KOVA_AUTH_EMAIL_DATABASE_ORIGIN` equal the exact approved
  staging project origin; `KOVA_EXPECTED_SUPABASE_PROJECT_REF` pins its ref. The
  committed production fallback project is rejected.
- Existing server-only `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`.
- `KOVA_AUTH_EMAIL_MESSAGE_IDS`: 1–5 exact new message IDs from this run's approved
  signup/recovery evidence, comma separated. IDs are selectors, never auth tokens.
- `KOVA_AUTH_EMAIL_RECIPIENTS`: 1–5 exact approved normalized email addresses,
  comma separated. This does not authorize additional recipients.
- `KOVA_AUTH_EMAIL_ISSUED_NOT_BEFORE`: canonical ISO timestamp from the current
  run, at most 15 minutes old. Both queue insertion time and issuance time must
  satisfy this boundary. Historical and unrelated entries stay untouched.
- `KOVA_AUTH_EMAIL_MAX_SENDS`: explicit integer 1–5, at most the number of selected
  message IDs, and within the independently reviewed mail/spending allowance.

These configuration checks do not grant deployment, paid usage, mail delivery or
recipient authorization. Verify the actual staging project binding, provider
sender/domain verification, SPF/DKIM/DMARC, current allowance and approval first.
No origin, recipient or key is inferred from production configuration.

Each invocation is bounded to the configured number of claims and three minutes;
each HTTP operation has a shorter timeout. There is no retry loop or scheduled
polling. Transient outcomes become eligible only after database backoff and a
later independently authorized invocation. At most five attempts per action are
allowed. Queue TTL is taken from existing state, capped at one hour, and further
bounded by the authoritative challenge expiry. Terminal/expired records produce
metadata-only dead letters. Provider errors and action links are never logged.

The dispatcher validates the exact renderer output, public origin, token digest,
recipient and action. It checks current account/challenge state and suppression
immediately before dispatch. Fenced leases use queue-before-dispatch row locking;
stale workers cannot acknowledge a replacement lease. Resend receives the same
`Idempotency-Key` and body on uncertain retries. Its documented retention is 24
hours, longer than this tool's maximum one-hour action lifetime.

The database and provider send are not one transaction. A revocation during an
outbound request can still deliver an unusable link; it does not reactivate the
challenge. Provider acceptance is not proof of inbox delivery. Mail-client QA,
actual inbox verification, bounce/complaint webhook configuration and physical
device tests remain operational checks.

Offline verification uses actual PostgreSQL RPC transitions and the actual HTTP
signup/renderer/provider-adapter path, with a synthetic PGMQ-compatible queue
projection and fake network transport. It does not prove the deployed PGMQ
extension version or distributed connection behavior. Before activation, verify
the existing `pgmq.q_auth_emails` projection has the expected `msg_id`, `read_ct`,
`vt`, `enqueued_at` and `message` columns, and run the staging concurrency checks.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email),
[idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[error classes](https://resend.com/docs/api-reference/errors), and
[Supabase Queues API](https://supabase.com/docs/guides/queues/api).
