# Library deletion confirmation and return focus

Date: 2026-10-19 UTC. Source-only follow-up to the actual9c Library deletion review.

## Changes

- A single chat names the chat in the title and shows its actual, owner-scoped Trash duration. For the default setting: `Move “Composer review chat” to Trash?`, with restoration available for 30 days. There is no unrelated permanent-file copy in this chat-only prompt.
- Instantly and temporary-chat prompts explain that a separate permanent-chat confirmation still follows. Files and other saved items state that deletion is permanent, bypasses Trash, and cannot be restored. Mixed selections list the first three titles, the full selection count, and separate chat/file/saved-item consequence counts.
- Pending confirmation captures its owner, lifecycle generation, named targets, and retention. Bulk confirmation executes the captured IDs rather than a later selection. Changed/unreadable retention cancels execution both at confirmation and after the closing animation. Missing targets also require a fresh confirmation. Account changes, browser-data cleanup, and navigation invalidate the pending operation.
- Actions buttons have exact item-to-button references. Cancel/Escape restores that invoker. Detached, hidden, or disabled invokers fall back to Search Library, then the Library root. A confirmed removal focuses the stable fallback before removing a row. Newer user focus is not overridden.
- A one-shot menu-to-dialog focus handoff suppresses the closing Actions menu's autofocus, including fast cancellation before the menu finishes closing. Actual deletion starts only after the first confirmation closes so the shared permanent-chat confirmation cannot compete with it.
- `ConfirmActionDialog` accepts an optional close-autofocus callback; callers without it retain existing behavior. The shared `moveChatToTrash`, second permanent-chat confirmation, durable deletion payloads/owner checks, and backend are unchanged.

## Verified

- 17 new executable source-level tests exercise copy, configured/custom retention, snapshot binding, Cancel/Escape closure, focus fallback, fast-menu closure, deferred execution, stale account/reset/navigation, changed retention, and corrupt storage using controlled fixtures. Deletion calls are stubs.
- 76 focused Library/Trash/detail/folder/retry/preview/settings-confirmation tests passed, 0 failures. The older Trash navigation source assertion now checks the specific retention summary instead of requiring the removed generic sentence.
- TypeScript, scoped ESLint, scoped Prettier, and `git diff --check` passed.

```sh
node --test tests/unit/library-delete-confirmation.test.mjs \
  tests/unit/library-action-menu-layout.test.mjs tests/unit/chat-trash.test.mjs \
  tests/unit/library-detail-navigation.test.mjs \
  tests/unit/library-folder-dialog-focus.test.mjs \
  tests/unit/library-folder-preferences.test.mjs tests/unit/library-retry-focus.test.mjs \
  tests/unit/spec400-library-density.test.mjs \
  tests/unit/spec400-library-trash-navigation.test.mjs \
  tests/unit/review-preview-focus.test.mjs tests/unit/review-shared-retry-focus.test.mjs \
  tests/unit/settings-deletion-dialog-focus.test.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/routes/library.tsx \
  src/components/ConfirmActionDialog.tsx src/lib/library-delete-confirmation.ts
```

## Verification limits

- No build, browser, deployed-candidate replacement, live service mutation, or real deletion was performed. The running actual9c candidate is unchanged.
- The tests execute extracted production handlers and summary code against controlled DOM-like objects; they do not establish Radix timing or actual keyboard focus in a rendered browser. Rebuilt-candidate acceptance should repeat pointer and keyboard Actions → Delete → Cancel/Escape in list/grid views, with default/custom/Instantly chat retention, file-only and mixed selections, and account/navigation interruptions.
- The existing non-atomic mixed bulk operation and backend deletion behavior are preserved. Permanently saved Library content is deleted on Continue even if a later separate permanent-chat confirmation is canceled; the mixed prompt explicitly describes the separate consequences.
