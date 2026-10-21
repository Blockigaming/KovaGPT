# Library mixed-selection, folder lifetime and return-focus recovery

Date: 2026-10-19 UTC. Bounded successor to the built `f35f129` review candidate. No build, browser session, runtime replacement, provider call, real deletion, API/schema change, or global authentication-helper change was performed.

## Changes

- Bulk Delete keeps canceled, failed and unattempted rows in the current list. Each verified durable/chat/Work/guest success removes only its completed IDs from current rows and selection. Partial success does not restore a whole old snapshot, replay a stale-filter load, or erase unrelated later selections. Work storage is touched only when Work targets exist. A pending-operation guard and disabled `Deleting…` control prevent repeat batch dispatch. Owner/lifecycle checks also run inside functional state updates; unmount invalidates the lifecycle.
- Guest deletion has its own explicit persistence contract. Unavailable/read-denied/malformed storage and failed writes throw; the route preserves or restores the failed row and shows an error. Deletion makes a single untrimmed write, retaining unrelated records even beyond the save helper's usual cap. The unrelated guest save/load behavior is unchanged.
- A successful folder Move removes only the moved IDs from the latest selection. Unmoved local items and newly selected unrelated items remain selected. Current account/lifecycle checks protect completion and delayed updater replay.
- Folder requests now require the captured owner and caller signal. They reuse the existing owner-checking Library header helper, check cancellation before dispatch, use same-origin credentials/no-store/redirect refusal, and bound response reads within a 15-second request lifetime. The folder component aborts its outgoing lifetime on owner/refresh/unmount and synchronously on its matching browser-clear event; other owners’ clear events are ignored. The route disables the organizer after its data is cleared. No `auth-fetch`, backend, API or database behavior changed.
- Folder Delete captures and names its exact folder. Cancel/Escape returns to its original Delete invoker; confirmed removal or an unavailable invoker returns to All items. Failure feedback remains visible and contents stay intact. Closing cannot steal focus after account/refresh/navigation changes or later interaction.
- Versions captures its original row Actions invoker, hands focus from the closing menu to the dialog, and restores the invoker or a stable Search Library/root fallback after close or replacement refresh. Failed initial item reads recover menu focus, including failure before the menu's closing animation. The dialog accepts the optional close-autofocus callback; its version operations and existing service contracts remain unchanged.

## Verification

The focused suite passed **195 tests, 0 failures**:

```sh
node --test \
  tests/unit/guest-library-deletion.test.mjs \
  tests/unit/library-bulk-recovery.test.mjs \
  tests/unit/library-folder-recovery-runtime.test.mjs \
  tests/unit/library-folders-client-lifetime.test.mjs \
  tests/unit/library-version-return-focus.test.mjs \
  tests/unit/library-versions-dialog-lifetime.test.mjs \
  tests/unit/library-version-controls.test.mjs \
  tests/unit/library-versions-runtime.test.mjs \
  tests/unit/library-delete-confirmation.test.mjs \
  tests/unit/library-folder-dialog-focus.test.mjs \
  tests/unit/library-folder-preferences.test.mjs \
  tests/unit/library-detail-navigation.test.mjs \
  tests/unit/library-action-menu-layout.test.mjs \
  tests/unit/library-retry-focus.test.mjs \
  tests/unit/library-folders-policy.test.mjs \
  tests/unit/spec400-library-density.test.mjs \
  tests/unit/spec400-library-trash-navigation.test.mjs
```

New tests execute the actual route handlers, folder/Versions components, folder client plus owner-header helper, and guest deletion helper with controlled hooks and stubbed transport/storage/DOM effects. They cover durable partial failure, separate-chat cancellation, Work failure, guest write/quota/access failure, later selections, repeat activation, owner/reset/unmount invalidation, request abort before/after credential resolution, bounded body reads, folder target binding, focus fallback and later-interaction protection. Versions tests additionally exercise read/download/replacement success and error, draft/file preservation, stale sequences and original extraction phases.

Existing tests were updated only for the new explicit callback/ref dependencies and to distinguish folder editor autofocus from folder-delete autofocus. Existing deletion confirmation, retention, naming, snapshot binding, detail navigation and preference assertions remain enabled.

TypeScript, scoped ESLint, scoped Prettier and `git diff --check` passed.

## Limits

- These are deterministic source/component/client tests, not actual Radix timing, rendered keyboard focus, connected accounts or live-service acceptance. Rebuilt-browser acceptance should repeat pointer/keyboard folder Delete → Cancel/Escape, folder mutation failure/retry, mixed partial deletion, Versions close/replacement/failure, and account/reset interruptions in list and grid views.
- Mixed deletion remains intentionally non-atomic. Already completed permanent file deletions are not undone when a separate later chat confirmation is canceled. Failed/uncertain durable requests remain visible for review; a request failure is not proof that the server made no change.
- Aborting a request or discarding a late result cannot roll back a server mutation that already committed. The guarantees are captured-owner authorization before dispatch, client cancellation, and suppression of stale UI effects.
- No missing bulk-download, project-move, file Trash, source-provenance or version-service contract was invented. This closes the specific source gaps only, not G05 or exhaustive finished-build acceptance.
