# Private original document files

The composer keeps original PDF, DOCX, XLSX and PPTX bytes in Library when the signed-in user enables attachment saving outside Temporary Chat. It sends only the bounded extracted text to chat. The original `File` remains an in-memory transport value; it is never added to a serialized chat attachment or browser storage. Original-file saving does not bypass the parser limits documented in `document-pipeline.md`.

The private `library-files` bucket accepts only the four document MIME types, at most 10 MiB per file. The existing tier storage quota applies atomically, including pending reservations. Chat already charges the existing analysis upload allowance, so this separate save does not charge that allowance again. There is an additional operational limit of 1,000 retained original-file records per account. Account changes, privacy transitions and unmount abort browser requests and invalidate toast retries.

## Publication and access

A service-only reservation binds the owner, logical Library ID, immutable generation, path, MIME type, size, SHA-256 and extracted text. It uses the canonical account deletion fence and Storage generation ledger. Ordinary Library creation and original-file reservation share a per-item advisory lock, preventing a reservation from claiming another existing Library item. Identical retries reuse the reservation; conflicting bytes or metadata do not overwrite it.

The server uploads without upsert, reads the stored bytes through a short-lived exact-origin signed URL, verifies their actual length and digest, and only then publishes Library metadata. A lost settlement response can be retried without retiring a successfully published original. The bucket has no browser read/write policies. Downloads require the initiating owner and displayed generation, recheck current access after reading, and return a named attachment with no-store and nosniff headers. Original files are downloaded rather than rendered as trusted HTML.

## Deletion, retention and export

Deletion first retires the exact generation, removes Storage bytes, then releases quota and removes matching Library metadata. Failed removals retain a durable cleanup obligation. The sweeper can repeat removal to catch late uploads. A failed producer cannot retire a settled original, and a stale generation cannot delete a retry.

Failed upload input metadata expires after a fixed 24 hours. Cleanup retains only a small non-content identity tombstone needed to reject stale replay and discover late objects. Expiry is processed by the existing cleanup worker; activating its configured cadence remains a deployment task. Explicit deletion clears the original name, extracted text and digest after confirmed object removal. Account deletion fences new activity, waits for active upload leases, drains original-file obligations and owned unregistered objects, and purges original upload records before Auth deletion.

Account export includes owner-scoped upload metadata and the exact bytes of each ready original, under the existing cumulative export budget. It validates owner and generation path bindings before reading Storage. It does not export signed URLs. Pending or failed input metadata remains owner-scoped and exportable until its cleanup retention deadline.

## Source verification

Executable SQL tests run with actual application roles and no service-role grant on `auth.users`. They cover publication, quota rollback, idempotency, direct-DML denial, two-owner ID collision, generation replacement after failed upload, fixed failure expiry and account deletion ordering. Runtime tests cover actual byte verification, lost responses, unauthorized signing targets, stale downloads/deletes and Storage failure. API/client tests use actual multipart `File` values and principal-pinned requests; export tests verify original binary output and reject mismatched paths.

This source adds no live bucket, migrations, uploads, quota changes or provider calls. Apply reviewed migrations and configure the existing cleanup worker through the established release process before claiming production availability. Library now provides cursor pagination, server-side search, immutable original-file history and text revisions; see `library-version-history.md`.
