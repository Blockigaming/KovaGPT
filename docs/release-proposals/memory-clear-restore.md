# Memory clear/restore release proposal

Status: RELEASE_BLOCKED. Source implementation and local tests do not establish deployed capability or live acceptance.

This descendant starts at `6594e97dac03eae104c04dd82b86985b5e46a7f1`. It preserves the prior product candidate, guest refresh cleanup, Auth/Azure work, and canonical migration history. No service mutation, browser launch, credential change, or deployment was performed.

## Scope and behavior

The Memory Center adds an explicitly separate reversible clear for ALL saved cross-chat memories, including unloaded/filtered records. It does not clear conversations, project memory, or same-chat summaries. Existing permanent Settings deletion still removes both summary stores and now retires recovery if the proposal is installed. Memory controls do not change custom instructions or consent.

Recovery uses server-held per-operation record snapshots, owner/target revision clocks, and idempotent operation IDs. It inserts only missing, unchanged records. It never restores a whole client array or overwrites newer records. A conflicting target requires explicit keep-newer/restore-the-rest or Cancel; the reviewed conflict token is revalidated. Failed/uncertain operations retain their ID and retry control. Account changes, browser reset, and unmount fence late UI results and stale handlers. Recovery controls are page-local and are lost on leaving/reset; this is disclosed. Source does not claim durable Undo across reloads.

New clears fail closed unless both an explicit `KOVA_MEMORY_UNDO_TTL_SECONDS` (integer 60–86400) and `KOVA_MEMORY_UNDO_CLEANUP_CONFIGURED=true` exist, and the proposal's capability RPC is installed. There is no default retention policy. The cleanup flag is an operator assertion, not proof that maintenance works. Existing restore/dismiss RPCs remain callable when new clears are disabled. Browser input cannot select a principal; authenticated server context supplies it.

The unapplied SQL proposal is `memory-clear-restore.sql`. It is outside canonical migrations because the migration CLI failed with EROFS creating its default home directory. No HOME override or permission bypass was attempted. A migration owner must review/promote it through the existing canonical process. It uses service-only RPCs/private tables and a narrowly scoped definer trigger to track revisions from existing authenticated writes. Resource bounds are 20 active inverses/account, 1000 captured rows/4 MiB per clear, and 10000 content-free receipts/account. Capacity errors abort new clears without deleting data.

`purge_expired_memory_inverses()` must be bound to authorized maintenance before activation. Payload expiry is checked during operations and maintenance; it is not a guarantee of exact-time physical erasure. Content-free receipts retain operation IDs, timestamps, counts, and terminal status to prevent old clear retries deleting newer additions. Their eventual retirement needs a replay-safe policy; the capacity bound prevents unbounded per-account accumulation.

## Other bounded corrections

- Shared sidebar navigation and history now scroll together. Header/account controls stay outside the shrinking scroll region. Removed the old short-landscape override that scrolled the entire sidebar. No controls removed or touch targets reduced.
- Guest Work text and duplicate feedback now disclose reload loss; guest storage purging remains unchanged.
- DOCX uses the installed library's default style overrides instead of appending duplicate Title/Heading1–6 IDs. Unique style IDs and preserved Arial/bold/custom color are checked in generated OOXML.
- A Work regression injects a newer original and an unrelated new plan during duplicate confirmation, then verifies both survive unchanged while the unsaved draft remains dirty.

## Required release gates

1. Migration review/promotion, explicit retention choice, cleanup binding and observed cleanup success, and replay-safe receipt-retirement policy. No activation was authorized here.
2. Real PostgreSQL multi-session race/deadlock/retry checks with current RLS/auth configuration. PGlite verifies transaction/ordering behavior but is not evidence of concurrent database sessions. Existing direct edits acquire row locks before the revision trigger's owner lock, while clear takes the owner lock first: competing transactions can deadlock and must roll back/retry safely. Local rollback tests verify inverse retention; production scheduling remains unverified.
3. Native browser retest: guest `/work` with More expanded at 390×568 and 390×700; short landscape; signed-in Plus/Pro Scheduled tasks; scroll and keyboard-focus reachability; stable header/Settings/account controls, search open/closed, and safe-area handling. No native browser was launched in this executor.
4. Native Memory confirmation, conflict focus/accessibility, account switching/reset, and current production service contracts. Configuration-disabled source must not be counted as a live passing integration.
5. DOCX re-render in native consumers after style correction. Earlier LibreOffice/PDF review belongs to 6594, not this descendant. Browser download delivery remains restricted in the parent's review sandbox.
6. Existing unresolved release approvals, exact checkpoint lineage/canonical gates and other product-family acceptance remain outstanding. Route/test count is not release readiness.
