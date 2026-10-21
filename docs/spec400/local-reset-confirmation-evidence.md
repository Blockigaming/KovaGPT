# Local profile reset confirmation (#131)

Implemented the Storage reset flow in `src/components/SettingsDialog.tsx`. Privacy account export is a separate concurrent change and was not modified by this patch.

- “Reset this profile's local data” opens a dedicated consequence dialog instead of deleting immediately.
- The dialog names chats, drafts, local handoffs, work data, image history, account preferences and ownerless transitional private data. It preserves the existing explanation that other profiles' scoped data, device-wide display preferences and cloud data remain.
- Cancel receives initial focus. Cancellation/Escape only clears the pending decision and restores the same visible trigger where still valid. No cleanup operation runs.
- Confirmation captures the exact principal (including resolved guest) and view generation. Unresolved identity, account changes, account round trips, section changes, settings close/reopen or a changed URL cannot use an old decision.
- The decision is consumed synchronously before cleanup, in addition to the existing in-flight ref. Double activation and stale replay cannot reset twice.
- Existing cleanup, expected-owner checks, failure counting, warning/success reporting and current-account-only settings clearing remain unchanged. A late completed reset cannot clear another account's mounted settings.

Verification performed on synthetic fixtures only:

- `node --test tests/unit/settings-local-reset-confirmation.test.mjs tests/unit/settings-deletion-dialog-focus.test.mjs tests/unit/principal-device-reset.test.mjs`: 14/14 passed.
- The seven new tests execute the actual extracted Settings handler/guard expressions with synthetic cleanup and focus dependencies. They cover open/cancel, safe initial/return focus, captured-owner confirmation, repeat activation, unresolved/stale auth, view/URL changes, account round trips, guest scope, late completion, partial failure and thrown failure.
- `tsc --noEmit`: passed.
- ESLint on Settings and the focused test: no errors; one existing `react-refresh/only-export-components` warning remains in Settings.
- Prettier check of those two files and `git diff --check`: passed. Settings was not whole-file formatted.

No browser render, real profile reset, account deletion, service call, build or deployment was performed. Modal focus trapping and rendered layout remain independent browser acceptance checks. No acceptance ledger row was changed by this worker.
