# Account event email

This source adds optional account event notifications through the existing
Resend resource. It sends no email on installation, preference updates or
application startup. Verification and requested password-recovery actions keep
their existing renderer, queue and bounded dispatcher; they are operational
messages and cannot be disabled through these notification preferences.

## Preferences and events

`GET /api/account/email-preferences` returns `{ version: 1, preferences }`.
`PATCH` accepts only `{ preferences: { known_event: boolean, ... } }`. The
verified current session determines the owner. The server rejects recipient,
account selectors, unknown events and nonboolean values. Updates merge only the
supplied events in PostgreSQL, so two tabs changing different events preserve
both changes. The UI stores no authoritative delivery preference locally.

Defaults are on for password changes, security-method addition/change/removal,
deletion scheduled and account deleted. New sign-in, email-address changed and
deletion canceled are off. These switches affect notification messages only.

Successful owned-auth audit events enqueue notifications in the same database
transaction as the security mutation. Failed/rolled-back mutations produce no
event. Event identities deduplicate repeated inserts; transient refreshes and
password-hash maintenance are not new sign-ins or password-change notifications.

The legacy 30-day schedule/recovery RPC definitions are not present in this
source tree. Their existing validated server results therefore feed a separate
service-only enqueue RPC after policy confirmation. This boundary is not one
transaction: an interruption can leave confirmed policy with notification
enqueue unconfirmed. The HTTP response exposes `emailNotification: unconfirmed`
without retrying deletion/recovery or claiming an email was sent. A repeated
request concerning an old pending schedule is not treated as a new event.

Final deletion requires the existing finalizer's cleanup and policy confirmation,
then a prepared email snapshot. Only an actual committed Auth-user deletion can
release that prepared notice. Unprepared user deletions and compatibility bridge
cleanup cannot synthesize a completed-account notice. The existing provider gate
still blocks the unaccepted Kova finalization path; these emails do not enable it.
Notification preparation failure is reported with a generic operator code and
does not prevent the already confirmed deletion. No final notice is claimed
without the snapshot and committed-delete proof.

Preferences are checked both at enqueue and immediately before provider work.
Ordinary notices additionally require the current verified recipient to match.
The final-deletion notice uses the preference/recipient captured before that
account disappeared. Its recipient is retained only for bounded delivery and is
removed by terminal completion or the explicit expired-event purge RPC. A later
preference change during an already outbound provider request cannot recall it.

## Bounded explicit delivery

The default invocation is a disabled report:

```sh
node scripts/auth-email/notification-dispatch.mjs
```

Only an independently authorized operator may execute:

```sh
node scripts/auth-email/notification-dispatch.mjs --execute
```

Private configuration must bind all of these:

- `AZURE_ENVIRONMENT=staging`, `CONTAINER_APP_NAME=ca-kovagpt-staging`, and
  `KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED=true`.
- `KOVA_AUTH_PUBLIC_ORIGIN` and `KOVA_ACCOUNT_EMAIL_EXPECTED_ORIGIN`: the same
  reviewed staging HTTPS origin.
- `SUPABASE_URL`, `KOVA_ACCOUNT_EMAIL_DATABASE_ORIGIN` and
  `KOVA_EXPECTED_SUPABASE_PROJECT_REF`: the same reviewed staging database.
  The committed production fallback project is rejected.
- Existing server-only `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`.
- `KOVA_ACCOUNT_EMAIL_EVENT_IDS`: one to five exact persisted event UUIDs.
- `KOVA_ACCOUNT_EMAIL_ISSUED_NOT_BEFORE`: the actual canonical UTC scope boundary,
  no older than fifteen minutes.
- `KOVA_ACCOUNT_EMAIL_MAX_SENDS`: one to five and no more than scoped event IDs.

No operator/browser recipient override is accepted. The queue supplies the
verified recipient. Only the existing fixed KovaGPT sender and locally rendered
content are sent. No secret, recipient, action link or provider response body is
included in console summaries. Provider idempotency binds the persisted event
ID; uncertain results are recorded without an automatic retry.

Each invocation is bounded to its scoped sends and three minutes, with shorter
database/provider deadlines. A successful provider response does not establish
inbox delivery. An uncertain completion must be reconciled; rerunning is not an
implicit permission to send again. Expired or failed delivery never rolls back
the original account change.

These limits are **per invocation**, not a new financial allowance. If used in
the existing one-time Auth acceptance, the operator must reserve every proposed
notification attempt in the same private trial-wide counter used for action
email, including uncertain attempts, before invocation. All action and
notification attempts together remain within the approved five-email ceiling.
This implementation does not independently enforce that shared operator
counter and grants no deployment, database migration, scheduler or email-send
authority. No worker, cron or cloud resource is created or activated here.

Local fixtures validate preferences, transaction rollback, recipient isolation,
delivery opt-out and provider uncertainty. They do not prove deployment,
provider validity, mailbox receipt or physical-device passkey behavior.
