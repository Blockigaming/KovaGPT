# Account data exports

KovaGPT's cloud-account export is a private, asynchronous portability path. It is separate from the device-data export used for browser-local chats and preferences.

Project-template exports include templates owned by the account, their immutable versions,
explicit grants, and safe audit events. A recipient's incoming grant is included because it is
part of that recipient's account state; another user's template snapshot is not copied into the
recipient's export. Idempotency receipts remain operational records and are excluded.

## Request lifecycle

1. An authenticated same-site `POST /api/account/export` request creates at most one queued job for the account and records the request in `account_audit_entries`.
2. A trusted scheduler calls `POST /api/internal/account-exports` with `Authorization: Bearer <secret>`. The route accepts `ACCOUNT_EXPORT_WORKER_SECRET`, falling back to the existing `CRON_SECRET`.
3. The worker leases a small batch with `claim_account_export_jobs`, reads only owner-authorized records, strips credential material and private moderation notes, and creates a bounded JSON artifact.
4. Before Storage I/O, the worker registers its unique claim generation and artifact path in a service-only durable cleanup outbox. The artifact is written to the private `account-exports` bucket. Completion requires the same generation, an unexpired lease, and no account-deletion fence.
5. `GET /api/account/export?download=1` returns a five-minute signed URL only to the authenticated owner of a completed, unexpired job.
6. Artifacts expire after seven days. Cleanup deletes the object before marking the job expired. Cancellation likewise deletes any completed object before clearing its storage reference.

## Data boundaries

The export covers the authenticated Supabase user record and the owner's supported KovaGPT records, including Projects, Library metadata and supported file bodies, memories, tasks, shares, connected-account metadata, connector audit events, Work/agent records, cross-device Work drafts and Recent state, billing state, preferences, notifications, support records, and generated content metadata. Operational Work sync counters and idempotency receipts are excluded.

OAuth state, access and refresh tokens, encrypted credentials, passwords, authorization headers, link/processor tokens, private keys, client secrets, state hashes, and private moderation notes are excluded recursively. Device-local chat history remains in the separately labeled device export because it is not present in Supabase.

## Production activation and verification

Source completion is not production completion. Before enabling the UI:

- apply all account-export migrations, including `20260904225916_account_export_generation_outbox.sql`, through the guarded migration workflow;
- stop and drain workers running older code before applying the generation protocol; old in-flight uploads were not registered in the outbox and cannot be retroactively guaranteed by this migration;
- configure a high-entropy worker secret through the approved production secret store, or reuse the deployed `CRON_SECRET`;
- schedule the internal route frequently enough to meet the published delivery expectation;
- verify the bucket is private and browser roles cannot list or mutate it;
- test request, lease, completion, owner-only download, cancellation, expiry, retry, and redaction with dedicated accounts;
- confirm monitoring detects queued-job age, repeated failures, lease exhaustion, cleanup failures, and scheduler outages;
- never log signed URLs, artifact bodies, credentials, or raw database errors.

Until those checks pass on the exact deployed revision, the capability must remain classified as requiring production configuration and verification.

## Delayed uploads and account deletion

A database lease check cannot make a network upload atomic with account deletion. Each
attempt therefore gets a new UUID generation and registers its exact Storage path before
sending bytes. Settlement checks that generation; a reclaimed worker with the same worker
name cannot settle or delete a newer attempt. Workers remove only their own attempt path.

`account_export_artifacts` has no cascading foreign keys. On cancellation, expiration,
reclaim, or Auth/job deletion, the generation becomes retired. A bounded, fairly ordered
sweep in the existing export worker deletes retired paths through the Storage API and retries
every 15 minutes (subject to scheduler cadence and backlog). Successful or empty deletion
does **not** remove the obligation: a paused external upload may finish afterwards. Rows
retain only UUIDs, paths, timestamps, and counters, never export contents or credentials.
These operational deletion identifiers must not be pruned without a separately proven
provider request-lifetime guarantee. Scheduler health and retained cleanup backlog need
monitoring even when no users have queued exports.

Deletion still waits for live worker leases and verifies current bucket contents before
Auth removal; expired/crashed workers cannot block account deletion indefinitely. Retained
obligations allow eventual removal after a late upload even when Auth and job rows no
longer exist. This is an **eventual external cleanup** guarantee, not a claim that private
bytes can never briefly reappear after deletion. Provider-only orphan bytes that the Storage
API cannot address require provider reconciliation; no Storage metadata is deleted by SQL.

Retryable export/file cleanup completes before billing cancellation and connector purges.
A cleanup `409` leaves those external services connected; partial private-file cleanup can
still have occurred as part of the explicitly requested, retryable deletion workflow.
