# Work cross-device synchronization

KovaGPT's Work sync contract persists account-owned Work tasks, reusable templates, agent drafts, and Recent-item state. The database and `/api/work/sync` route provide the durable server boundary; clients must not claim cross-device continuity until they use this contract and the exact production migration is verified.

## Data and authorization boundary

- `work_saved_records` stores `task`, `template`, and `agent_draft` payloads.
- `work_recent_items` stores recent and pinned references to owned Work resources and agent runs.
- Authenticated browser roles may select only rows where `owner_id = auth.uid()`.
- Browser roles cannot insert, update, delete, or execute mutation functions. The authenticated Kova server derives the owner from the bearer token and calls service-role-only RPCs.
- Titles and payloads never enter audit metadata. Audit rows contain only identifiers, record types, operations, and revisions.
- Saved records and Recent items are included in account data exports. Sync counters and idempotency receipts are operational state and are excluded.

## Client synchronization protocol

1. Keep the last fully applied `nextCursor` for the signed-in account.
2. Request `GET /api/work/sync?cursor=<cursor>&limit=<1-500>` until `hasMore` is false.
3. Apply `savedRecords` and `recentItems` by their globally increasing `syncVersion`; a non-null `deletedAt` is a tombstone and must remove the item from active views.
4. Generate one UUID `mutationId` per logical mutation and reuse that UUID for retries.
5. Send the locally observed `revision` as `expectedRevision`. New saved records use revision `0`; a passive first Recent touch omits the revision.
6. On HTTP 409, stop automatic overwrite and reconcile against a fresh server snapshot. Never silently choose the last network response.
7. Advance the stored cursor only after every returned change is durably applied locally.

Responses are `no-store`. Cross-site writes, non-JSON writes, oversized bodies and payloads, malformed UUIDs, unknown fields, excessive request rates, and unavailable distributed rate-limit protection fail closed.

## Deletion, bounds, and retry behavior

- Deleting saved Work creates a tombstone and preserves its payload for synchronization and account portability.
- Forgetting a Recent item creates a Recent tombstone even when the referenced saved record has already been deleted.
- A mutation receipt makes a retry return the original result without applying the operation twice.
- Each account is limited to 500 active and 2,000 total saved records, and the same bounds apply independently to Recent items.
- Mutation receipts may be removed only after seven days through the bounded service-only `purge_work_sync_receipts` function. Production operations must schedule this maintenance and alert on failures.

## Production activation and verification

Source completion is not production completion. Before any UI labels Work or Recents as synchronized:

- merge the exact source revision only after all required CI gates pass;
- apply `20260903213000_work_cross_device_sync.sql` through the guarded migration workflow;
- schedule bounded receipt cleanup and monitor table growth, RPC errors, conflicts, and sync lag;
- verify owner isolation with two dedicated accounts and confirm browser roles cannot mutate either table or call any mutation RPC;
- exercise create, update, conflict, retry, delete, tombstone, pin, unpin, forget, multi-page sync, offline retry, sign-out, and account-switch behavior on at least two supported clients;
- confirm account exports include saved Work and Recent state without counters or mutation receipts;
- keep local-only UI records labeled local until their migration succeeds, and never discard a local record automatically after a conflict or failed upload.

Until the exact deployed revision and migration pass these checks, this remains a source-ready backend capability rather than verified production cross-device synchronization.
