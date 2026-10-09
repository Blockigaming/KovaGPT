# Core UI CI follow-up — 2026-10-09

This follow-up starts from published PR #445 commit
`2386b8a1b6061c9242d3f55b3ac66bccfdb0c8ec`. It preserves the published interface and
addresses the failures observed in KovaGPT CI run `37932859984` and Shared UI run
`37932860117`, plus one concrete mobile target-size defect found during focused
verification. The earlier `core-ui-review-20261009.md` remains a historical record.

## Hosted evidence and exact causes

KovaGPT CI's verify job `113827607550` passed all 3,560 unit tests, all nine API
tests, and all 503 integration tests. The integration pass includes the unchanged
generated production Worker boot and dynamic-route test in real workerd. These
hosted results close the earlier local full-suite and workerd environment
uncertainties. The isolated database job also passed.

The same job passed formatting, lint, typecheck, repository and dependency audits,
release-contract checks, the default Cloudflare build, all four bundle budgets,
and the source/build audit (795 files, zero source maps and zero warnings). Its
accessibility source check passed. The browser accessibility step then failed four
phone/desktop and light/dark cases because they still required the intentionally
removed Terms link on the guest home. The documents remain accessible through
Settings → Help & legal. The tests now exercise that keyboard-operable path and
check both document destinations while retaining the semantic, theme, touch,
overflow and skip-link assertions.

Shared UI reported 118 passes and four failures in each of Chromium, Firefox and
WebKit. The four failures assumed that the two-page offline review fixture still
contained the former marketing navigation. Its navigation test now uses the actual
compact interface and a fixture-only Back to overview link, preserving a meaningful
keyboard round trip. The related production public-shell tests distinguish compact
core pages from marketing pages and verify legal discovery through Help.

The hosted KovaGPT visual, browser smoke and release checks were skipped after the
accessibility failure. Their pass is not inferred from the earlier successful
stages; a fresh hosted run is still required after publication.

## Small product correction

An existing mobile drawer test measured a 36px-wide header control against its
unchanged 44px requirement. The shared `.kova-sidebar-header .kova-header-button`
rule fixed the width, minimum width and flex basis at `2.25rem`, with no mobile
override. The mobile rule in `src/styles/sidebar-core.css` now sets the drawer
header controls' width, height, minimum dimensions and flex basis to 44px. Desktop
spacing and the icons are unchanged. The unchanged drawer test passed against a
fresh production Node build containing this fix, including viewport containment
and focus return.

The swipe tests now use the current Plugins and Plans labels. Their gesture
thresholds, cancellation, draft preservation, modal exclusion and focus checks
remain intact. The public route matrix explicitly selects a stored theme instead
of assuming that operating-system light mode overrides the requested dark default.
No authentication, provider, persistence, price, legal-text or deployment contract
changed, and the original logo assets remain untouched.

## Focused local verification

| Check                                    | Result                                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest accessibility                      | Four Chromium phone/desktop × light/dark cases passed.                                                                                                                                                                                       |
| Hydration                                | Two unchanged theme-paint cases and one unchanged early-interaction case passed.                                                                                                                                                             |
| Command palette                          | Two unchanged phone/desktop clipping, motion and focus-return cases passed.                                                                                                                                                                  |
| Mobile swipe                             | Both `/` and `/library` cases passed after label updates.                                                                                                                                                                                    |
| Mobile drawer                            | One unchanged case passed against the rebuilt Node bundle with 44px targets.                                                                                                                                                                 |
| Shared UI navigation fixture             | Four Chromium phone/desktop × light/dark cases passed.                                                                                                                                                                                       |
| Production public shell                  | Both directly affected Chromium cases passed.                                                                                                                                                                                                |
| Public surface matrix                    | Three viewport cases passed, covering 48 route/theme/width combinations across eight routes with explicit theme checks.                                                                                                                      |
| Final changed-file format and lint       | Prettier passed for all nine changed supported files; ESLint passed for all seven changed script files.                                                                                                                                      |
| Fresh production Node build              | Passed with the mobile target-size correction.                                                                                                                                                                                               |
| Final Cloudflare build and typecheck     | Passed; the build used the Cloudflare module preset and its source/build audit passed for 979 files with zero source maps or warnings.                                                                                                       |
| Final bundle budgets and Worker artifact | All four budgets passed; the deployable Cloudflare Worker artifact test passed 1/1.                                                                                                                                                          |
| Refreshed isolated source review         | Passed: 74 cases, 86 fresh captures with hash and visual inspection; zero failures, page errors, external requests or overflow findings. All four mobile Search/Close targets measured exactly 44 × 44px, and all four Billing links passed. |
| Fresh hosted CI                          | Pending publication and its new run.                                                                                                                                                                                                         |

The 12 accessibility, hydration, palette, swipe and drawer cases passed across the
initial invocation and targeted reruns. This is not a claim that a second complete
12-case invocation ran against the new bundle: the final drawer case specifically
covers the CSS correction. The tests use isolated responses and blocked external
writes; they do not certify live sign-in, provider operations or billing.

Two local Firefox probes timed out while creating a page, before navigation or
assertions. They are not counted as passes. The previous hosted cross-engine
results are reported above; no new local Firefox or WebKit pass is claimed.

## Evidence and boundary

Evidence basenames are `kova-ci3012-hosted-evidence.log`,
`ci-followup-focused/results.json`, `ci-followup-focused/swipe-results.json`,
`ci-followup-focused/final-drawer-results.json`,
`core-ui-followup-shared/results.json`, `core-ui-followup-public/results.json`,
`core-ui-followup-matrix/results.json`, and their individual browser logs. Build
and typecheck evidence is recorded in `core-ui-followup-node-build.log`,
`core-ui-followup-cloudflare-build.log`, `core-ui-followup-typecheck.log`,
`core-ui-followup-bundle.log`, `core-ui-followup-worker-artifact.log`,
`core-ui-followup-format.log` and `core-ui-followup-lint.log`.

The scope is source publication to the existing PR branch while preserving its
current descendants. No merge, force-push, deployment, provider mutation or
purchase is included.
