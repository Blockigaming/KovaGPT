# Projects rename form: validation, persistent errors and dirty-dismiss handling

Updated: 2026-10-19 UTC. Scope: the Projects list's Rename dialog, its focus bookkeeping and isolated regression tests. Project services, unrelated actions and existing layout/color tokens are unchanged.

## Implemented

- Name and Description (optional) have explicit label/input associations through `rename-project-name` and `rename-project-description`. Existing 100/1,000-character bounds remain.
- For spec400 #123/#125, Name validation waits until blur or a submission attempt. Empty and whitespace-only values show **Enter a project name** immediately below the field, linked with `aria-describedby` and `aria-invalid`; entering a nonblank name resolves it. The required semantic remains, while `noValidate` allows the same inline explanation on submission instead of a browser-only popup. An invalid submit focuses Name, retains both values and never calls the update service.
- The submit button says **Save project** when idle and **Saving…** while pending, with `aria-busy`. Name, description and Cancel are disabled while saving. A synchronous operation reference rejects duplicate submissions before React re-renders.
- A clean Cancel, backdrop click, Escape or close-button action can close directly. If either raw field differs from the original project, the draft stays mounted and an AlertDialog asks whether to **Keep editing** or **Discard changes**. Opening this decision never submits a project update.
- Keep editing, including dismissing the confirmation with Escape, preserves both draft fields. Explicit discard closes both layers and clears only the unsaved draft. Pending saves ignore all dismissal paths.
- For spec400 #133, failures keep the draft open, restore controls and show a persistent inline alert associated with the form. It includes the failure detail (with a fallback for blank/non-Error failures), confirms the changes remain and identifies **Save project** as the retry action. It replaces the expiring failure toast and remains through edits, Keep editing and a pending retry until success or explicit dismissal. The authoritative project refresh remains. Successful saves keep the existing trimmed update payload, optimistic list update and success toast, then close the editor.

## Identity and focus protection

- The editor and discard confirmation are gated by the resolved owner during render. Input values are masked immediately on an account transition, before effect cleanup, so closing animations cannot reveal the previous owner's draft.
- Both field validation and save failures, including their ARIA descriptions, are also masked immediately on account switch, sign-out or unresolved auth. Opening/closing the editor and auth cleanup reset error and visited state so another project cannot inherit it.
- Auth changes and unmount invalidate operation references. Late success/failure responses cannot close another editor, display stale notices or refresh the incoming account's list through the old completion.
- Keep editing returns to the last focused editor field, falling back to Name. Closing returns to the current menu trigger for that project, falling back to Search if the trigger was replaced or removed.
- When both modal layers close, final focus is deferred to confirmation cleanup. URL changes, account changes, disconnected/hidden targets and a newer user focus choice prevent stale focus restoration.

## Checks and limits

- `tests/unit/project-rename-dialog.test.mjs`: 22 passing synthetic cases covering visited/submitted Name validation, whitespace rejection without service calls, associated labels/errors, pending text, clean Cancel, dirty Cancel/backdrop/Escape/close, Keep editing, explicit discard, duplicate/pending submission, persistent save failure through edits and retry, blank/unknown failures, fresh-editor reset, resolved/unresolved/signed-out principal transitions, and focus races. Spinner assertions inspect rendered elements rather than source whitespace.
- Expanded Projects/preference/cleanup/focus/management regression command: 82 passed, 0 failed.
- Tests execute the actual source handlers, form/confirmation JSX, owner-reset effect, sort/history checks and shared focus helper with synthetic DOM references and deferred service fixtures. No real project mutation is performed.
- Final `./node_modules/.bin/eslint src/routes/projects.tsx` and full `./node_modules/.bin/tsc --noEmit`: exit 0. Prettier checks on all three scoped files and the Projects diff check: exit 0.
- Radix focus trapping, backdrop geometry, animation timing and real-browser keyboard behavior still require rendered verification. These synthetic tests are not a browser acceptance claim.
- No application build, runtime replacement, deployment or live provider operation was performed.

Regression command:

```sh
node --test tests/unit/project-rename-dialog.test.mjs \
  tests/unit/project-list-preferences.test.mjs \
  tests/unit/management-list-preferences.test.mjs \
  tests/unit/principal-session-preferences.test.mjs \
  tests/unit/principal-browser-storage.test.mjs \
  tests/unit/principal-device-reset.test.mjs \
  tests/unit/projects-clear-search-focus.test.mjs \
  tests/unit/projects-retry-focus.test.mjs \
  tests/unit/spec400-management.test.mjs
```
