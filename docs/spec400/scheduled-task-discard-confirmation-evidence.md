# Scheduled-task unsaved-change confirmation

## Scope

Replace the editor's native `window.confirm` with the existing shared `AlertDialog`. The reported reproduction was a dirty schedule dismissed through Escape or Cancel. This patch changes only editor presentation and dismissal control; service functions, draft validation, mutation payloads, retry identity, and backend behavior are unchanged.

## Behavior

- Clean close, including reverting edits to their original values, closes without prompting.
- Dirty close opens a labeled confirmation naming the current draft and the loss of its unsaved edits. An unconfirmed prior request is explicitly described as still unconfirmed; closing does not cancel it.
- Keep editing receives initial focus. Keep editing and the confirmation's Escape path preserve the current draft and restore its prior editor control, or the editor heading if that control disappeared or became disabled.
- Discard changes uses the shared destructive-styled action and closes the confirmation first. Only its close-autofocus callback closes the editor, allowing the existing editor `onCloseAutoFocus` hook to restore the original page opener without competing nested restoration.
- A synchronous decision latch rejects repeated close/discard activation during the confirmation's closing lifecycle. Unmount/account-lifetime cleanup suppresses stale confirmation callbacks.
- Existing saving/uncertain-state gates remain. Closing while a save is pending is blocked synchronously, including before the next render. Confirmation actions are explicitly non-submit controls outside the form.
- The confirmation inherits shared viewport/safe-area height caps, wrapping, footer stacking, and 44px minimum button targets. The editor's separate fullscreen-phone class is not applied to the confirmation.

## Verification

Passed 104 focused task-related tests:

```sh
node --test tests/unit/scheduled-task*.test.mjs \
  tests/unit/account-task-action-lifetime.test.mjs \
  tests/unit/task-schedule-zone-label.test.mjs \
  tests/integration/scheduled-task-terminal-state-source.test.mjs \
  tests/integration/connectors-tasks-settings-source.test.mjs
```

Also passed:

- `npm run typecheck`
- Focused ESLint on the editor and its two changed test files
- Prettier check on the changed source, tests, and this document
- Scoped `git diff --check`

The editor regression tests execute real source through the existing hook harness, with simulated DOM references, explicit confirmation lifecycle callbacks, and mocked service functions. These tests do not establish rendered Radix focus trapping, screen-reader output, or measured phone geometry.

No build, browser session, live task creation, provider calls, commit, or deployment was performed. Rendered follow-up should cover dirty Escape, Keep editing, confirmation Escape, repeated confirmation, Discard-to-original-opener focus, and narrow-phone long-title wrapping.
