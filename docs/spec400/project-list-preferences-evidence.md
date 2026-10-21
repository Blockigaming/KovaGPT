# Projects preferences: requirement 23 follow-up

Date: 2026-10-18 UTC. This closes the Projects mounted preference-cleanup gap identified in the initial [list-preference evidence](./list-preferences-evidence.md). Source and isolated checks do not establish rendered-browser acceptance or every part of requirement 23.

## Changes

- Projects query, sort, ownership scope, archived-section expansion and grid/list view now use the shared principal-session preference hook. The registered base is `kova-project-list`, yielding `kova-project-list:v2:<principal>`.
- Defaults remain an empty query, Last opened sorting, All scope, collapsed archives and Grid view. Query length is capped at 512 code units; saved JSON is capped at 4,096. Sort/scope/view values are allowlisted and archives requires a real boolean. Project records, membership information and visit history are excluded from these preferences.
- Account changes return new-principal defaults before hydration. Unresolved auth does not read or write preferences. Mounted cleanup resets all five controls without re-creating cleared storage. Denied storage remains usable in memory.
- Before hydration, a narrow migration reads only the resolved owner's former `kova-project-list:<raw owner>` key. Existing canonical values always win. The legacy key is removed only after the canonical write succeeds, or when canonical state already exists. Failed migration does not throw or destroy the recoverable legacy value.
- The ownerless `kova-projects-view` choice is no longer read or written. It is not silently adopted by any account. The harmless old device preference is left untouched; each principal can choose its own view.

## Last opened preservation

- Existing valid timestamps remain in the original per-owner local key `kova-project-opened:<raw owner>`. This is still device-local history, with the same last-activity fallback for unvisited projects. No server-wide or cross-device claim is added.
- Reads validate object shape, finite nonnegative timestamps within the supported Date range, bounded project IDs and a 1 MiB input limit. At most the newest 5,000 valid visit entries are retained in memory; malformed entries and prototype names are excluded. No cleanup write happens just from reading history.
- Mounted principal cleanup clears the displayed history and ignores other/outgoing principals. Opening a project re-reads current durable history before recording the new visit, so an old rendered callback cannot restore visits removed by cleanup. The owner is checked before writing.
- Existing project service reads, mutations, invitations, sorting fallback, action controls and layout tokens are unchanged. Central registration for the new session base is coordinated with the integrating parent patch.

## Checks

- Focused Projects, shared preference, cleanup, keyboard-focus and management suite: 60 tests passed, 0 failed, including the direct mounted-history clear-event check.
- Full `./node_modules/.bin/tsc --noEmit`: exit 0.
- ESLint on Projects and the shared hook: exit 0.
- Prettier checks on all eight scoped files and `git diff --check`: exit 0.
- Tests execute the actual preference hook with deterministic effect scheduling, the actual Projects sort comparator, and the actual project-open callback against synthetic storage. This establishes account gating, migration safety and preserved ordering without calling project services.
- No build, runtime replacement, deployment, provider request or destructive application action was performed.

Focused command:

```sh
node --test tests/unit/project-list-preferences.test.mjs \
  tests/unit/management-list-preferences.test.mjs \
  tests/unit/principal-session-preferences.test.mjs \
  tests/unit/principal-browser-storage.test.mjs \
  tests/unit/principal-device-reset.test.mjs \
  tests/unit/projects-clear-search-focus.test.mjs \
  tests/unit/projects-retry-focus.test.mjs \
  tests/unit/spec400-management.test.mjs
```
