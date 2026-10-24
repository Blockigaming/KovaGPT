# Account export focus handoffs

Validated locally on 2026-10-19 UTC. This is bounded source/ref unit evidence, not browser or screen-reader evidence.

## Change

- Successful Request account export moves focus from its initiating button to the stable, programmatically focusable status region named **Account export status**. Existing Requested, Preparing, and Ready labels are unchanged.
- Successful Prepare account download moves focus to the newly rendered, explicit **Download account export** link. It does not activate the link, navigate, or claim file delivery.
- Focus ownership begins only while the initiating button owns focus. Later focus, pointer, keyboard, browser-history/hash, page-hide, or window-blur events relinquish it, including interaction followed by focus returning to the body.
- Completion verifies the same account, open panel, abort-controller lifetime, operation/read sequence, and URL. Closing, reopening, unmounting, clearing principal data, changing accounts, or starting a newer status read cancels the handoff. Invisible, inert, detached, disabled, and expired destinations cannot receive focus.
- Request failures focus the existing error feedback when the request button is disabled or removed. Download failures retain/restore the enabled Prepare account download button while the existing alert announces the failure. Session-storage tracking rejection focuses feedback without dispatching a request.
- Initial status reads, polling, and ordinary rerenders never acquire focus ownership. Marker/idempotency, cancellation, private destination validation, link expiry, and native-link guards are retained.

## Verification

All commands completed with exit code 0:

1. `node --test tests/unit/account-export-focus.test.mjs tests/unit/account-export-settings.test.mjs tests/integration/account-export-source.test.mjs`: **31 passed, 0 failed** (11 new focused regressions, 15 existing settings regressions, 5 source integration checks).
2. `./node_modules/.bin/eslint src/components/AccountExportPanel.tsx tests/unit/account-export-focus.test.mjs`: passed.
3. `npm run typecheck`: passed (`tsc --noEmit`).
4. `./node_modules/.bin/prettier --check src/components/AccountExportPanel.tsx tests/unit/account-export-focus.test.mjs`: passed.
5. `git diff --check -- src/components/AccountExportPanel.tsx`: passed.

The new fixture executes the source component and actual export UI/client-error helpers with simulated hook commits, element refs, DOM focus/events, timers, session storage, and deferred responses. It explicitly covers batched completion with no intermediate render, repeated renders, stable status focus during polling, later interaction, current focus elsewhere, URL/history changes, account replacement, close/reopen, principal clearing, unmount cleanup, inaccessible targets, uncertain/rejected requests, failed preparation, storage denial, expired links, and newer reads.

No browser, build, live account export, provider request, download, publish, or deployment was performed. Actual browser/assistive-technology validation remains a separate stage.

## Owned uncommitted files

- `src/components/AccountExportPanel.tsx`
- `tests/unit/account-export-focus.test.mjs`
- `docs/spec400/account-export-focus-evidence.md`

Other concurrent checkout changes were left untouched.

## Manual status-refresh successor

The explicit Refresh export status read now captures the same scoped focus intent after advancing the read sequence. It waits for loading to finish, then focuses the named status region; a failed read returns the enabled Refresh control. Background polling does not acquire focus. Later pointer/key/focus/navigation activity, superseding reads and account/lifetime changes cancel the handoff. Three added component-harness guards cover successful refresh, a newer user interaction, and failed refresh. Combined focus/settings/native-link suites:31 passing. Browser verification remains pending for this successor.
