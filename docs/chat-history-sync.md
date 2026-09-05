# Ordinary chat account history

Signed-in ordinary chat snapshots now have an owner-scoped account record and a durable IndexedDB outbox. Guest chats and Temporary Chat never enter that outbox. Explicitly converting a Temporary Chat preserves its memory boundary. Earlier local-only signed-in chats remain on the device until the user chooses **Save existing chats to my account**.

The client pins each request to the initiating account. One browser tab edits a given account at a time; other tabs can read its current durable cache. Device storage survives reload and offline use. An account switch or device privacy reset cancels in-flight views, and a persistent local generation prevents a late write from recreating erased browser records. Browser storage failures stay visible; account sync failures do not count as acknowledgments.

Each account row has a revision and ordered sync cursor. Writes first persist an immutable mutation request, then send it with an expected revision. Replaying an accepted request returns its existing receipt without charging quota again. A newer device edit survives an earlier own acknowledgment. Edits made concurrently on another device produce an explicit conflict; the user can inspect/download both copies and choose which to keep. Conflict decisions wait until the authoritative reset scan finishes. Automatic active-list saves cannot reverse an explicit archive or deletion while IndexedDB work is queued.

Snapshots contain at most 1,000 messages and 4 MiB. An account may retain 1,000 active/archived chats within a 50 MiB history ceiling and its existing storage allowance. Reads return one bounded body per page. Account exports also read one chat body at a time under the shared cumulative export budget. Database records, counters and mutation receipts cascade with account deletion. All mutation and read-initialization paths take the canonical account-deletion advisory lock before the chat lock and fence check.

Deletion tombstones remain for 90 days, and idempotency receipts for eight days, with bounded cleanup per request. Retiring tombstones changes the account epoch. A stale offline draft cannot silently recreate an expired identity: explicit recovery uses a new chat ID. These limits are source contracts, not evidence of production deployment.

Validation includes actual authenticated/service-role database tests without direct Auth-table grants; API ownership/body bounds; controller recovery, conflict and account-switch races; and actual-browser IndexedDB reload, two-account isolation, cross-tab reset fencing and exclusive Web Locks. Run:

```sh
node --test tests/unit/chat-history*.test.mjs
npx playwright test --config=playwright.browser.config.ts tests/browser-runtime/chat-history-storage.spec.ts --project=chromium
```

The repository migration must be deployed through the approved release process before live account sync becomes available. No production database, provider or identity setting is changed by this source package.
