# Library folder preference restoration

Date: 2026-10-19 UTC. Bounded follow-up for requirement 23, using the existing Library preference record and folder service.

## Implemented contract

- `kova-library-filters:<principal>` in session storage now includes `folder` beside the existing query, type, sort, source, and date fields. No key migration, local-storage view change, service, schema, cursor, or sort-contract change is introduced.
- Same-account route remounts can restore All, Unfiled, or a canonical durable folder UUID. Missing, malformed, non-object, or unsupported stored selections fall back to All. Guest hydration cannot restore an authenticated folder ID.
- Folder state carries its principal. A changed or unresolved principal sees All before passive hydration, and outgoing folder callbacks cannot update the incoming account. Requests and preference writes await current-principal hydration. Persistence does not wait for a successful item-list load. Restored query and debounced request query are synchronized so the initial request cannot carry the outgoing account's query.
- The existing principal-keyed `LibraryFolderOrganizer` is unchanged. Its successful current owned-folder load validates the restored UUID; missing, deleted, or foreign IDs fall back to All and that correction is persisted. Pending or failed folder loads do not incorrectly treat the selection as deleted. The existing folder endpoint filters by authenticated owner, and the existing generation checks reject stale organizer completions.
- Existing exact-owner principal cleanup removes the same preference record. The mounted handler clears folder/query/type/source/date/sort, ignores outgoing-principal callbacks, and suppresses writing the removed preference back while the cleared state is active. Storage failures remain optional and do not prevent in-memory selection changes.

## Checks

- Seven new executable source-level tests cover same-owner remount restoration, existing filter preservation, account transition before hydration, stale callbacks, unresolved auth, malformed preferences, owned-folder validation, cleanup, unavailable storage, and the request hydration gate.
- The focused Library/detail/folder/preference/cleanup regression set passed 65 tests, 0 failures.
- TypeScript, route ESLint, scoped Prettier, and `git diff --check` passed.

```sh
node --test tests/unit/library-folder-preferences.test.mjs \
  tests/unit/library-detail-navigation.test.mjs \
  tests/unit/library-folder-dialog-focus.test.mjs \
  tests/unit/library-retry-focus.test.mjs \
  tests/unit/management-list-preferences.test.mjs \
  tests/unit/principal-browser-storage.test.mjs \
  tests/unit/principal-device-reset.test.mjs \
  tests/unit/library-folders-policy.test.mjs \
  tests/unit/library-folders-migration.test.mjs \
  tests/unit/spec400-library-density.test.mjs \
  tests/unit/spec400-library-trash-navigation.test.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/routes/library.tsx
```

## Limits

- These tests execute the actual route preference state/effects and existing organizer validation with controlled hooks and local fixtures. A remount simulates the lifecycle used after Back; this is not rendered-browser Back/Forward, full DOM, authenticated live-service, or deployment evidence.
- No build, browser interaction, server restart, running-candidate replacement, live data mutation, or production request was performed. Detail/share/delete implementations and rendered geometry are unchanged.
- Real-browser remount/Back/Forward, account transitions, successful/failed folder-service loads, and refresh after deleting a selected folder still need acceptance on a rebuilt candidate.
- Scope validation remains asynchronous through the existing organizer. A syntactically valid stored ID can initially reach the existing owner-authorized item request before the owned-folder list resolves; failed folder-list requests retain the preference pending a successful retry.
- This does not establish scroll restoration, cross-tab/browser-session persistence, or principal isolation of every other existing visual filter control. The new folder projection is principal-gated; existing scalar query/type/source/date controls still use the route's passive hydration mechanism.
