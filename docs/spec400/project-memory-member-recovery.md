# Project memory and member-removal recovery

## Source-proven failures addressed

The existing Memory panel cleared its loading state after a rejected list request without storing an error. Its initially empty array could then appear as “No memories yet.” Memory deletion propagated a rejection out of the confirmation, and repeated Enter events could issue concurrent adds before a rerender. Top-level member removal and invitation revocation had no failure handling or account/project lifetime checks.

## Narrow implementation

- Memory has separate persistent load, add, and delete errors. Initial list failure never renders the empty-state claim. Read retry preserves previously loaded rows and the current draft, including when retry fails.
- A synchronous operation ref serializes memory writes and blocks overlapping reads. Add accepts the persisted row from the unchanged `addMemory` service; it clears only the submitted draft, keeping any newer typing. Success does not force a list refresh or remount.
- Unconfirmed add failures retain the draft and explain that the result is uncertain. “Refresh memories” lets the user inspect server state before manually retrying. No automatic mutation resend is performed.
- Memory removal retains its confirmation and row until the existing delete request resolves. Failure leaves a persistent error with Retry removal and Cancel. Pending confirmation cannot close or issue duplicate deletes. Error focus, original-trigger focus on cancel, and a surviving summary focus target after successful removal are explicit.
- Member remove/revoke uses the existing `@/lib/projects.functions` import path and original secure-facade payloads. The two operation types are single-flight. Failure keeps the named member or invitation row and a persistent account/project-scoped Retry/Cancel panel; success changes only the confirmed row without a refresh that would erase other data or invite drafts.
- Operation lifetime objects and tokens suppress late success/error updates, including account and project switches, sign-out, unmount, and account A→B→A. Member removal rechecks lifetime after the deferred import and before issuing the request. Saved stale retry callbacks cannot restart the earlier operation.

## Local evidence

`tests/unit/project-memory-member-recovery.test.mjs` executes the actual source functions with deferred, in-memory service mocks and an explicit hook/element harness. Its 50 cases cover initial failure versus true emptiness, successful persistence, retry, draft retention, rapid repeated Enter/click, read/write serialization, confirmation retention, focus callbacks, late success and failure, stale retry, account/project/sign-out/unmount, and A→B→A isolation. The existing four-case member accessibility suite remains unchanged and passes.

Commands:

- `node --test tests/unit/project-memory-member-recovery.test.mjs tests/unit/project-members-accessibility.test.mjs` — 54 passing
- `node_modules/.bin/eslint 'src/routes/projects.$projectId.tsx' tests/unit/project-memory-member-recovery.test.mjs` — passes without warnings

Formatting was restricted to Memory, the member-removal state/handler, its sibling feedback panel, the two callback bindings, and the new test/document files. Other route blocks are owned and validated separately.

## Limits and release status

This is source-component/mock evidence, not browser, DOM/Radix, live authentication, network, provider, database, RLS, or end-to-end evidence. Actual focus behavior still needs browser verification in the combined release. No build, browser, commit, schema change, access change, or live provider/database mutation was performed for this slice. Existing service and authorization contracts were not modified.

An already-issued server mutation cannot be cancelled by these client lifetime guards; only its obsolete client completion is ignored. `addMemory` has no idempotency key, so a rejected response may follow persistence and manual add retry can create a duplicate. The UI states that uncertainty and offers a list refresh; it makes no rollback or exactly-once claim. Member/remove and revoke success follow the current service response contract, without inventing a new readback or transaction guarantee.
