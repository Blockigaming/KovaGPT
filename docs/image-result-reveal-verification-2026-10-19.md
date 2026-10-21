# Images completed-result reveal

## Change

The Images page now records a one-use focus intent when a signed-in user starts generation. Only that request's successful, validated result can consume the intent after React commits the completed UI. Focus moves to the visible, programmatically focusable **Generated image** heading, then that heading scrolls into view without animation. No action button is automatically activated.

The intent is canceled by later pointer, keyboard, input, wheel, touch, or focus interaction; router navigation; history/hash changes; hidden tabs; window departure; account/data reset; and unmount. Before revealing, the page rechecks the request generation, account, result URL, current URL/router state, active element, target visibility, and modal state. Image-preview regeneration permits its expected dialog-close focus return, while subsequent user interaction still cancels the reveal. Repeated successful results with the same image URL each receive their own intent.

The real image transport, provider route, quotas, generation gates, Library save, clipboard, download, and existing browser-history behavior were not changed.

## Verification

All verification below is local source/runtime testing. Responses in the new tests are inert local fixtures. No build, browser run, live generation, provider request, save, or download was performed.

Passed:

- `node --test tests/unit/image-result-reveal.test.mjs tests/unit/image-action-lifetime.test.mjs tests/unit/image-lightbox-primary-focus.test.mjs`: 20 tests.
- `node --test --test-name-pattern='image generation' tests/unit/recovery-library-project-images.test.mjs`: 2 tests.
- `npm run typecheck`.
- `node_modules/.bin/eslint src/routes/images.tsx`.
- Prettier check on the changed route and two test files.
- `git diff --check`.

Broader suite limits, left unchanged:

- `node --test tests/unit/image-*.test.mjs`: 57/58 passed. The pre-existing `image-principal-client.test.mjs:98` save-account test omits the `@/lib/upload-quota.server.mjs` dependency from its mocked module map and fails before exercising its assertion. The source import and missing mock are both present at HEAD.
- Running the whole mixed `recovery-library-project-images.test.mjs` file with the focused tests produced 23/24 passes. Its unrelated Library preview CSS class-count assertion expects two occurrences and finds one; the earlier sheet consolidation is already documented as the cause. Only three image-focus fixture dependencies were added to that file.

The new ten-test runtime suite covers successful post-commit focus/scroll, dropped submit focus, one-shot cleanup, interaction during the request and before commit, navigation/unmount, principal/epoch/result mismatches, focus/modal/visibility guards, failure/quota/invalid responses, stale requests, duplicate/signed-out submissions, identical-URL regeneration, dialog-close return focus, and refused focus without scrolling.

## Remaining visual check

Phone viewport geometry and actual rendered focus/scroll behavior still need the parent task's authorized browser verification. This evidence does not claim a browser or 390 × 844 visual pass.

## Failure and geometry successor

A current failed generation now returns the preserved prompt's focus through the same one-shot ownership guard. Quota/login/settings/lightbox states suppress restoration before their modal DOM mounts. Later typing, pointer/key/focus/scroll activity, navigation, account changes and stale generations retain priority. Success still reveals the result heading without activating Save or Download.

The image-edit select/button corners are aligned with the approved8px shared controls (44px targets retained); the earlier pre-spec rounded-2xl/full-circle assertion is updated to that explicit new geometry. Combined result-reveal/action-lifetime/lightbox suites:21 passing. Two independent recovery-image cases also passed in the worker's check. No live generation, save or download is credited. Failure focus and enabled edit-control pixels remain pending the successor render.
