# Storage upload cleanup obligations

Library-image and Project-file producers reserve a unique generation and immutable Storage
path before upload. Reservations take the same account lock as deletion and fail if either
the requester or owner is fenced. A three-minute lease bounds live publication. Account
deletion waits for live uploads before starting destructive file cleanup.

Publication checks the generation and account fences again. A failed or expired generation
cannot become published. Project-file publication settles inside its metadata transaction;
Library-image publication compensates only its unique attempt if settlement is refused.
Published objects remain governed by the existing reference-aware Storage lifecycle.

Pending failures become retired cleanup obligations. The service-only outbox intentionally
has no Auth foreign key. Each worker batch removes at most 25 exact retired paths through
the Storage API, then records the successful attempt. It never deletes the obligation just
because Storage was empty: a delayed upload can finish after the first sweep or Auth deletion.
Only identifiers and paths are retained, never file contents or credentials. Retired entries
are retried fairly every five minutes; published entries are never selected for removal.

Production activation requires the reviewed migration and an authenticated scheduler call to
`POST /api/internal/storage-artifact-cleanup`, without a body or query, using the dedicated
`STORAGE_ARTIFACT_CLEANUP_SECRET` bearer credential. Configure a cadence of at most five minutes
and alerts for failed or overdue batches before enabling the upload changes. This document
does not claim that a scheduler has been configured or that production cleanup has run.

Do not prune retired obligations without a separately reviewed retention and maximum-late-write
contract. Removing them based only on a successful delete would reopen the orphan-upload race.
