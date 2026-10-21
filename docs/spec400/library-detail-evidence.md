# Library detail links, modified metadata, and account storage

Source verification: 2026-10-18. This change builds on `f3454fb` and preserves its single/bulk chat-to-Trash behavior. It does not change the current color system.

## Implemented using existing contracts

- Durable Library rows open `/library?item=<uuid>&generation=<uuid>`. Search parsing validates both identifiers and retains an explicit invalid-link state. Synthetic chat, Work, workspace-reference, guest, and generationless rows do not receive private-item URLs.
- These are authenticated, generation-stable item links. They open the **current revision** of the exact item generation, not a frozen historical revision. The existing SQL contract makes `content_generation` immutable for that item; text/original replacement can advance its revision. The existing strict `readLibraryItem` handoff still checks the expected revision.
- The detail lookup reuses `GET /api/library/items?id=...&generation=...`, its captured-owner authentication headers, same-origin credentials, no-store behavior, redirect refusal, timeout, and abort support. Returned identity and revision are checked before rendering. No bearer share service, access grant, new API, or database change was added.
- Direct links work independently of loaded list rows. Loading, invalid, signed-out, unavailable, cleared-account, and retryable transport states are distinct. A 404 does not claim whether an item is deleted or belongs to a different account. Owner changes, newer links, dismissal, cleanup, and unmount conceal/abort stale detail work.
- Copy link appears in eligible row actions and in the loaded inspector. The link includes only item ID and generation; it excludes titles, content, account credentials, list searches, and revision. The inspector explains that copying does not grant access.
- A clickable Library parent and Close use in-place history for row-opened details, or replace a direct detail entry with Library. Existing list/filter state is retained in the mounted page. Focus restoration checks the original URL/account and later navigation, uses `preventScroll`, and falls back to Library search/main for a direct link.
- The item model accepts an optional `updated_at`; the client accepts only a valid timestamp. Details render that value with a `time` element. Missing or invalid values say “Not recorded for this item.” Saved dates are never relabeled as modified dates. The paginated list still does not supply a cursor-consistent last-modified sort, so no such sort was added.
- The closed-by-default Details disclosure lazy-mounts the existing owner-keyed `StorageDashboard`, labeled “Account cloud storage.” It measures account-wide usage through the existing authenticated `getMyStorage`, including non-Library content, and retains its loading/error/unknown-limit/refresh states. Loaded-row file sizes remain separately labeled and are never used as quota usage.
- Availability text distinguishes unsupported **file** Trash from the already-supported recoverable chat removal.

## Executed verification

`node_modules/.bin/tsc --noEmit --pretty false` passed after the implementation and navigation guards.

The following focused command passed **40/40** tests:

```sh
node --test \
  tests/unit/library-detail-navigation.test.mjs \
  tests/unit/library-versions-runtime.test.mjs \
  tests/unit/spec400-library-density.test.mjs \
  tests/unit/spec400-library-trash-navigation.test.mjs \
  tests/unit/storage-dashboard-quality.test.mjs \
  tests/unit/library-retry-focus.test.mjs \
  tests/unit/library-action-menu-layout.test.mjs
```

The new tests execute the URL/date helpers, authenticated client with mocked transport, detail hook with delayed and out-of-order responses, row-open/close callbacks, and focus restoration callback. They cover synthetic/invalid IDs, exact generation checks, strict versus generation-stable revisions, unknown/deleted/inaccessible 404s, account changes, sign-out, Back/newer-link cancellation, cleanup/unmount, retry, repeat clicks, and safe direct-link dismissal. Existing storage tests verify real-query selection, unavailable limits/errors, owner transitions, and that browser estimates are excluded from cloud percentage.

## Baseline regression limitations

An expanded Library unit-test run surfaced nine unrelated baseline fixture/assertion failures. A targeted rerun of the three affected files yielded 5 passing / 9 failing:

- `library-original-api-client.test.mjs`: three tests fail because their module fixture does not provide `@/lib/upload-quota.server.mjs`, already imported by `src/routes/api/library/files.ts` at `f3454fb`.
- `library-save-idempotency.test.mjs`: five tests fail for the same missing fixture dependency, already imported by `src/lib/library.functions.ts` at `f3454fb`. The only change to that server-function file here is the optional TypeScript metadata field.
- `recovery-library-project-images.test.mjs`: one older source assertion expects two copies of the former preview-sheet class and sizing pattern; `f3454fb` already has only one because the main inspector uses its dedicated responsive class.

These fixtures were not broadened or weakened in this change. The updated action-menu and version-client tests add only the dependencies/callback expectation required by the new UI/client.

## Not established by this evidence

This is local source, hook, mocked-client, and typecheck evidence, not authenticated browser or live-service acceptance. No build, server launch, deployment, paid action, provider request, production API call, or backend/schema edit was performed for this change. Browser review should still exercise refresh/new-tab details, narrow/wide inspector layouts, Back/Forward, sign-in continuation, and Details storage in the candidate build. Existing folder-filter persistence across a full remount, globally correct last-modified sorting, project references, source-chat provenance, extraction completeness, and file Trash remain separate contracts/work.
