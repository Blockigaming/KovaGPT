# Account deletion grace-period interface

## Current boundary

- Settings → Privacy → Delete account opens `AccountDeletionGraceView` in the fixed `unavailable` state.
- Production scheduling and recovery are not connected. The screen offers no live scheduling/recovery operation, dates, success claim, wipe, sign-out, or legacy immediate-delete retry.
- The old Settings `requestAccountDeletion(..., "DELETE")` handler and its cleanup/sign-out path were removed. The existing irreversible API and transport are unchanged and retain their backend regression tests. They must not be used to implement delayed scheduling.
- The Settings entry and dismissal are bound to the same account, Settings section, URL, and still-visible invoker. Account changes and unresolved authentication close or suppress the view.
- Billing's related account-deletion paragraph now describes the same unavailable status rather than directing people to functioning self-service deletion.

## Isolated private review

The existing private adapter registers `/__private-review/account-deletion-preview`, with separately bundled HTML, JavaScript, and CSS. The review page imports the actual presentation view and a local-only reducer. Production code does not import the review controller.

All review identities, timestamps, and outcomes are explicitly synthetic. Fixture controls are outside the shared view. There are no requests, persisted account data, provider calls, timers, promises, or asynchronous completions. Captured owner and generation checks reject events from earlier owners, resets, and closed/reopened dialog lifetimes. Unmount discards the local state without a pending completion to replay.

States include confirmation/Cancel, accepted schedule, schedule rejection, recovery rejection, recovered/active, unknown, exact deadline, overdue, explicitly started, explicitly completed, and production-unavailable. Schedule acceptance and recovery can be exercised through local controls; fixtures also permit direct state inspection.

The accepted sample request is October 19, 2026 at 12:00 UTC; the effective time is November 18, 2026 at 12:00 UTC. The interval is exactly 30 × 24 hours (720 hours). Both dates and the `America/Los_Angeles` time zone are displayed, including the daylight-saving transition.

## Final cutoff clarification

The final parent clarification supersedes the initial overdue-enabled proposal: recovery is available within the 30-day period. At the exact deadline and afterward, the isolated review displays an expired recovery window with actual deletion status unknown and no Recover action. The local clock cannot mark deletion started or completed. Only explicit synthetic started/deleted fixtures render those states. No post-deadline recovery extension is promised.

## Accessibility and interaction

- 8 px controls, 12 px panels, and at least 44 px action targets.
- Responsive, scrollable Radix dialog with linked title/description and Cancel/Close initial focus.
- Guarded return focus; Escape, Close, and backdrop dismissal never schedule or recover an account.
- Schedule/recovery success has a restrained polite status announcement; failures use an alert.
- The explanation that closing does not cancel a scheduled request appears before the action footer.

## Validation

- Final focused/backend-regression selection: 80/80 passing.
- Directly changed account/memory/local-device integration case: 1/1 passing.
- New grace-period suite after the final view adjustment: 8/8 passing.
- Application TypeScript check passed at the earlier shared-worktree snapshot. The dedicated account-review dependency graph passed with zero diagnostics after the cutoff update. The parent owns final combined typechecking.
- Focused ESLint: zero errors; two fast-refresh warnings (the existing Settings module and standalone preview entry).
- An expanded 83-test selection had 82 passes and one unrelated preexisting failure: `tests/integration/principal-settings-storage-source.test.mjs:24` expects an outdated settings-loading regex in `src/routes/__root.tsx`. The same assertion fails against the committed HEAD source. That unrelated assertion was left intact.
- No application/review build, browser review, commit, deployment, live operation, migration, auth change, or worker change was performed in this task.

## Release gate

This is ready for source-level review and the parent's combined validation. It does not deliver production account scheduling or recovery. Production activation requires a separately approved authoritative schedule/recovery backend and cleanup lifecycle, plus end-to-end validation. Do not route the scheduling button to the existing irreversible DELETE endpoint.
