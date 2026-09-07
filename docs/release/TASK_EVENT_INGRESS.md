# Verified Tasks event intake

Repository source implements native Slack, GitHub and Gmail event adapters. Intake remains disabled by default, and no provider registration, subscription, watch, secret entry or production deployment was performed. Event Tasks also require the Tasks foundation runtime, a healthy worker, the selected provider enabled in its database runtime, an unexpired exact connection grant, and current provider configuration proven by a verified native delivery.

## Configuration and owner activation

| Server setting                    | Purpose                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `TASK_EVENT_INGRESS_ENABLED`      | Must be exactly `true`; unset is disabled.                                        |
| `TASK_SLACK_SIGNING_SECRET`       | Secret for raw-body Slack request verification.                                   |
| `TASK_SLACK_APP_ID`               | Exact Slack app binding for event callbacks.                                      |
| `TASK_GITHUB_WEBHOOK_SECRET`      | Secret for raw-body GitHub HMAC verification.                                     |
| `TASK_GMAIL_PUSH_AUDIENCE`        | Exact HTTPS callback audience ending `/api/tasks/events/gmail`.                   |
| `TASK_GMAIL_PUSH_SERVICE_ACCOUNT` | Exact verified Google service-account email in Pub/Sub OIDC tokens.               |
| `TASK_GMAIL_PUSH_SUBSCRIPTION`    | Exact `projects/.../subscriptions/...` envelope binding.                          |
| `TASK_GMAIL_TOPIC`                | Optional exact `projects/.../topics/...` target for explicit Gmail watch consent. |

The owner must provision and verify native provider configuration, enter secrets through the approved secret store, apply repository migrations through the release process, deploy source and run the authorized worker before enabling these settings. Never expose provider secrets in browser variables. Slack and GitHub native requests post to `/api/tasks/events/slack` and `/api/tasks/events/github`; Gmail authenticated Pub/Sub pushes post to `/api/tasks/events/gmail`.

The worker imports `pumpScheduledTaskEvents({signal, limit})` directly. A short caller-owned deadline bounds each invocation. The adapter records fresh configuration heartbeats; changing the configuration fingerprint invalidates native delivery proof until a new signed delivery arrives. `scheduled_task_event_grant_ready(uuid)` is service-only and is checked by the foundation at event task admission and execution. A configured URL alone does not make an event task ready.

## Ownership, delivery and retries

Callbacks verify raw bytes before storing a bounded reference receipt. Slack has a five-minute signature window. GitHub uses the signed body's hash for deduplication, not its unsigned delivery header, and rejects stale content events beyond the retention window. Pub/Sub requires Google's fixed JWKS origin, RS256, exact issuer/audience/service-account/subscription, short token lifetime, and bounded key refreshes. Unknown key IDs cannot create unrestricted outbound JWKS requests.

The durable service-only inbox stores provider/resource references, not callback message bodies. Worker leases and ordered `(grant, resource)` cursors walk all matching current grants. Each private provider read rechecks the exact current grant, account state and Lockdown. Slack conversation metadata decides whether paired public or private read/history scopes are required, including private channels whose IDs start with `C`. Provider content is fetched with the grant's current token and admitted through the foundation's current consent/plan/filter/deduplication contract. Events predating the saved consent are excluded. Transient failures retain the unfinished target; completed receipts drop reference contents, and bounded pruning removes old operational receipts after seven days.

Gmail push history IDs are hints, never message content or permission to replay a mailbox. A user explicitly initializes a current profile baseline through `TaskGmailEventSource({grantId,userId})`. Enabling push registers a watch only after explicit consent, and preserves any established baseline and unfinished page. Only an explicit baseline reset discards that history. The worker renews consented watches near expiry. Stopping local delivery revokes local consent immediately; the remote watch expires naturally because stopping a shared Google app watch could affect another valid connection.

History pages and message indices are persisted before processing. Admission precedes each checkpoint, so a failure retries an idempotent event without skipping later messages. History advances only after the page is exhausted. A missing message may be skipped; other access failures do not advance it. An expired Gmail history cursor requires the owner to establish a new baseline; the adapter never silently runs old mailbox content. Source-action revisions are separate from routine checkpoint versions so background work cannot invalidate a displayed action unnecessarily, and stale watch responses cannot revive a disabled source.

## Data lifecycle and validation

`scheduled_task_gmail_cursors` is owned by `user_id` and cascades through its exact grant and Auth owner. The safe service-only export view `scheduled_task_event_source_export_rows` exposes `user_id, grant_id, email, state, watch_consent, watch_expires_at, created_at, updated_at`; paginate with `grant_id`. It omits token material, cursor contents, leases and global provider verification state. The operational inbox is not a user-content export source.

Focused executable tests cover native signatures/JWT claims and refresh bounds, actual database roles/inbox leasing and pagination, account fences, source revisions, native readiness, watch preservation, admission/checkpoint crash recovery, history expiry and current private Slack access. Full schema migration ordering and hosted worker/browser integration must run on the aggregate release tree with the Tasks foundation migration before this adapter migration.

Primary provider contracts: [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Slack conversation metadata](https://docs.slack.dev/apis/web-api/using-the-conversations-api), [GitHub webhook verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Pub/Sub push authentication](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions), and [Gmail push history](https://developers.google.com/workspace/gmail/api/guides/push).
