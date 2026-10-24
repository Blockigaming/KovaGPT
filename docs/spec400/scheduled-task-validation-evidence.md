# Scheduled-task editor validation

## Scope

Item 126 lacked visited-field feedback and a linked validation summary. The editor now exposes those states for Title, Prompt, Date, Time, Timezone, and the explicit save/run confirmation.

The client helper calls the existing client-safe `parseTaskPayload(..., true)` from `src/lib/scheduled-task-policy.mjs`. It reuses the service's title/prompt presence and bounds, valid local calendar/time shape, and timezone recognition. A fixed valid counterpart isolates date and time field errors; it does not resolve a scheduled instant. Explicit consent remains a client prerequisite and is not added to the service payload.

Future-date admission, recurrence, DST ambiguity/gaps, event filters, source permissions, and server admission remain service-owned. No next-run times are calculated or guessed. Timezone remains editable and validated in event mode because the existing service also checks the submitted timezone for event tasks.

## Interaction changes

- Untouched fields remain quiet. Blur reveals a field's current error; correcting it removes that error.
- An invalid Save submission displays and focuses an error summary. Its links focus the corresponding visible field, with stable IDs, `aria-invalid`, and `aria-describedby`.
- Invalid fields do not silently disable Save, allowing the user to request feedback. Busy, pending-request, running-task, unavailable-execution, and missing-event-filter restrictions remain.
- The editor is now a `noValidate` submit form. All auxiliary buttons, including the four nested Gmail source controls, explicitly use `type="button"`; Save is the sole submit control. A source-level test covers conditionally rendered controls as well as the rendered fixture.
- Clearing Date or Time preserves the other field and does not silently replace a deliberately cleared time.
- Valid requests preserve the previous payload shape and mutation identity. An uncertain operation retains and retries its original payload without rebuilding or revalidating it.
- An uncertain create now says “Couldn’t confirm task creation,” since a commit may have succeeded before readback failed.
- Existing dismissal-focus, dirty-discard, and busy guards are retained. No routes, CSS, backend rules, or scheduler semantics changed.

## Verification

Passed 59 focused checks:

```sh
node --test \
  tests/unit/scheduled-task-draft-validation.test.mjs \
  tests/unit/scheduled-task-validation-ui.test.mjs \
  tests/unit/scheduled-task-editor-focus.test.mjs \
  tests/unit/scheduled-task-return-focus.test.mjs \
  tests/unit/scheduled-task-mobile-dialog.test.mjs \
  tests/unit/scheduled-task-form-accessibility.test.mjs \
  tests/unit/spec400-management.test.mjs \
  tests/unit/account-task-action-lifetime.test.mjs \
  tests/unit/scheduled-task-load-recovery.test.mjs
```

Also passed `npm run typecheck`, focused ESLint for the editor, nested Gmail source, and validation helper, Prettier for the changed files, and `git diff --check`.

The tests execute the real validation helper and source components with local hook/DOM doubles and stubbed services. They are not rendered-browser or provider evidence. No build, browser run, live task, provider call, or deployment was performed.
