# Management list preferences: requirement 23

Date: 2026-10-18 UTC. Source patch based on `f3454fb`. This evidence covers Scheduled tasks and Plugins preference persistence plus central cleanup registration. It does not establish all of requirement 23 or rendered acceptance.

## Implemented

- Scheduled tasks remembers the search query and Active / Paused / All selection in principal-scoped session storage. New sessions default to an empty query and Active.
- Plugins remembers the search query, current-catalog category and All / Connected selection in principal-scoped session storage. Defaults are an empty query, all categories and All.
- Both use `usePrincipalSessionPreferences`, `safeBrowserStorage` and `principalScopedStorageKey`. The registered storage bases are `kova-scheduled-task-list` and `kova-plugin-list`.
- The preference parsers return explicit allowlists. They never retain task records, execution status, counts, connection health, account identities, permissions, scopes or credentials. Existing task/provider reads and mutations are unchanged.
- Queries are capped at 512 UTF-16 code units. Stored JSON exceeding 4,096 code units, malformed JSON and non-object values fall back to defaults. Enum values must be supported; categories must exist in the presentation catalog and be at most 120 code units. Inputs also have the query length limit.

## Identity and cleanup behavior

- Unresolved authentication performs no preference storage access. It does not read guest preferences.
- A changed principal renders defaults immediately, before passive hydration. Previous-principal query text cannot appear in that render or be written under the new principal's key.
- Hydration and repeated effect setup only read storage. Task/provider loading cannot overwrite saved selections with defaults.
- Only user preference changes write. Updates are revalidated, merge synchronously and reject stale callbacks from a different principal or an unmounted hook.
- The existing principal-cleared event resets the matching mounted hook to defaults without writing the deleted value back. Events for another or outgoing principal are ignored.
- Denied storage getters, reads and writes do not throw through the page. Current-page preference changes continue in memory.
- The central cleanup planner now includes exact-owner legacy keys: session `kova-project-list:<raw owner>`, session `kova-library-filters:<principal>`, and local `kova-project-opened:<raw owner>`. Guest keys are removed only by guest cleanup; another account's keys and device view choices survive. No prefix-wide preference deletion is introduced.

## Scope limits

- This initial patch did not change Projects or Library routes. The subsequent [Projects preference follow-up](./project-list-preferences-evidence.md) adds same-owner migration, scoped view preferences and mounted cleanup handling for Projects.
- The initially documented Projects mounted clear-event gap is closed in that follow-up. Its query/sort/scope/archive/view controls now reset through the shared hook, and visit history has a matching clear-event handler.
- Library folder-scope restoration, nested-scroll restoration, real-browser Back/Forward/remount behavior and rendered account transitions are not established by these preference tests.
- No application build, runtime replacement, deployment, live-provider request or destructive application operation was performed for this patch. Tests use installed dependencies and synthetic/local fixtures.

## Checks

- Focused preference, principal cleanup and device-reset tests: 32 passed, 0 failed.
- Expanded management, Plugins, scheduled-task, preference and cleanup regression run: 112 passed, 0 failed. This included the repaired management-default assertion.
- Full TypeScript check: `./node_modules/.bin/tsc --noEmit`, exit 0.
- ESLint on the new hook and both changed routes: exit 0. Prettier checks on all ten scoped files and `git diff --check` on the modified tracked files: exit 0.
- New hook lifecycle tests execute the actual transpiled hook with deterministic state/effect scheduling, including the pre-effect account-change render. They are not rendered-browser tests.
- The previous management test's direct `useState("active")` source assumption was replaced with an executable parser-default assertion and hook-wiring check.

Focused command:

```sh
node --test tests/unit/management-list-preferences.test.mjs \
  tests/unit/principal-session-preferences.test.mjs \
  tests/unit/principal-browser-storage.test.mjs \
  tests/unit/principal-device-reset.test.mjs
```

The expanded run added `plugin-connection-preview`, `plugin-directory-integration`, `plugin-review-catalog`, `scheduled-task-connected`, `scheduled-task-editor-focus`, `scheduled-task-form-accessibility`, `scheduled-task-load-recovery`, `scheduled-task-retry`, `scheduled-task-run-labels`, `scheduled-task-worker`, `scheduled-tasks-foundation`, `spec400-management` and `spec400-plugins`, all under `tests/unit/` with the `.test.mjs` suffix. An earlier run also passed all three existing `plugin-preview-entry` checks; those perform in-memory bundling with `write: false`, without changing application output or runtime.
