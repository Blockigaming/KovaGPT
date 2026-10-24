# Scheduled-task editor dismissal and phone geometry

## Reported reproduction

The parent review reported that, at phone width 390px, opening a synthetic active task through its title focuses the editor's Title field, but Escape leaves focus on the document. It also reported that the phone editor remained inset and rounded despite its intended fullscreen rules. This change does not claim a new rendered-browser verification.

## Changes

- Capture the opener in the route before mounting the portaled editor. Title, New, and creation-receipt openings retain their exact button. Open, Edit, and View runs retain the persistent row-menu button rather than a menu item that disappears.
- Restore at Radix's close-autofocus event and prevent its default restoration. The editor accepts an optional callback and skips its legacy animation-frame restoration when the route supplies one. There are no new timers or input-autofocus changes.
- The source menu does not restore over the newly opened editor. A replaced editor cannot consume another editor's return context.
- Use the persistent, programmatically focusable page heading if the opener is absent, disconnected, hidden, inert, or disabled. URL, account, generation, and newer-focus guards prevent stale restoration. Account reset and unmount invalidate the return context.
- Preserve dirty-discard confirmation, busy dismissal blocking, explicit consent, and existing service/mutation behavior.
- Scope the authoritative fullscreen geometry to the scheduled-task dialog below 640px. Its dimensions and square corners now override shared important dialog caps. Preserve desktop geometry, sticky footer behavior, and safe-area padding; stack phone footer actions at full width.

## Local verification

Passed 46 focused tests:

```sh
node --test \
  tests/unit/scheduled-task-editor-focus.test.mjs \
  tests/unit/scheduled-task-return-focus.test.mjs \
  tests/unit/scheduled-task-mobile-dialog.test.mjs \
  tests/unit/scheduled-task-load-recovery.test.mjs \
  tests/unit/account-task-action-lifetime.test.mjs \
  tests/unit/scheduled-task-form-accessibility.test.mjs \
  tests/unit/spec400-management.test.mjs
```

Also passed:

- `npm run typecheck`
- Focused ESLint on `src/routes/scheduled-tasks.tsx` and `src/components/ScheduledTaskEditor.tsx`
- Prettier check on the changed source and tests
- `git diff --check`

The callback tests execute the source handlers with DOM doubles; component tests execute the source with a hook harness. CSS tests inspect the scoped declarations and their priority. These checks do not establish rendered Radix behavior or measured geometry.

No build, browser session, provider calls, task creation, backend changes, or deployment were performed. A subsequent authorized rendered check should confirm title→Escape and menu Edit/View runs→Escape restoration, 390px fullscreen geometry, and stacked sticky actions.
