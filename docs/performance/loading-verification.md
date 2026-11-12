# Loading verification

This covers the performance work in PR #642. It is not acceptance of the separate 436-feature checklist or a claim that Kova matches ChatGPT.

## Executable acceptance cases

| Experience                       | Verification                                                                 | Product budget / assertion                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| First signed-in visit            | Five concurrent fresh browser profiles, desktop and phone viewport           | Mean hydrated editable composer <2,500 ms; p95 <4,000 ms                                                               |
| First guest visit                | Five fresh profiles; actual guest email-entry surface, no submitted login    | Same loading budget; email entry works                                                                                 |
| Reload                           | Same five profiles reloaded                                                  | Same budget; correct account surface remains usable                                                                    |
| Slower device and assets         | Chromium CPU rate 4; 150 ms added per script/style/font request              | Editable chat <7,500 ms                                                                                                |
| Loaded-tab return                | Fifty browser activations over five sessions, hosted validation held pending | Mean observation <100 ms; p95 <200 ms; trusted activation, no authority gate, editable composer, intact drafts         |
| Session validation contention    | Fifty synthetic focus/visibility returns, five browser sessions              | No owned auth probes; UI remains usable while hosted validation is pending                                             |
| Network loss and return          | Loaded page offline; hosted validation fails; network restored               | Real typing works and draft survives both transitions                                                                  |
| Browser lifecycle                | Chromium CDP freeze/active                                                   | Draft and editability survive; this does not simulate an OS discard                                                    |
| Client navigation                | Library and Projects via actual sidebar links; history return                | Click to visible destination <2,000 ms; returning chat is editable                                                     |
| Visual stability and main thread | PerformanceObserver records LCP, layout shifts and long tasks                | CLS at readiness <=0.1; paint and long-task values retained as diagnostics                                             |
| Auth and security                | Existing focused refresh, logout, cross-account, MFA and worker tests        | Fresh validation, terminal failures and account switches remain fenced; no owned credentials accepted in Supabase mode |
| Early interaction                | Existing hydration-interaction-guard browser tests                           | Scripts delayed; early shortcuts replay once; controls do not dispatch before hydration                                |

The loading/recovery matrix runs Chromium, Firefox and WebKit on desktop/phone viewports in Application Interface Fit CI. Firefox uses a narrow touch viewport rather than unsupported `isMobile` emulation. CPU throttling, lifecycle freeze and native activation checks use Chromium; unsupported cases are explicitly identified rather than represented as tested on other engines.

## Measurement boundaries

- Budgets above are Kova acceptance targets, not published or measured ChatGPT averages.
- First-visit readiness is sampled in the browser from navigation start until hydration, the intended editable input and absence of an account gate. Guest readiness means the actual email-entry surface, not authenticated chat access.
- The timing fixture uses synthetic hosted identities and mocked account data. Five concurrent browser sessions do not establish the capacity of the live Azure service, database or model provider.
- Request routing disables browser HTTP caching. Same-profile reload results must not be described as warm HTTP-cache measurements.
- Slower-device checks add fixed request delay and CPU throttling; they do not reproduce physical phone hardware, bandwidth limits, packet loss or geographic distance.
- Native activation disables Playwright's forced-focus emulation and requires trusted browser-generated visibility events. Headed Chromium runs under Xvfb in CI. Missing actual background/foreground transitions fail the test.
- Native readiness is observed after two animation frames. It excludes browser chrome activation delay, OS scheduling before the event, initial page loading and discarded/suspended-tab restoration.
- Paint, layout-shift and long-task values are snapshots during controlled tests, not production field Core Web Vitals. Unsupported observer metrics are recorded as `null`, not a false zero or passing visual-stability claim. No production telemetry is enabled by this change.
- Real Azure cold starts, cache/CDN behavior, discarded tabs, sustained production load, first model token and provider response speed still require separate live measurements. This test suite does not call paid models, send emails or change infrastructure.
- Direct ChatGPT inspection was denied by the connected browser's host policy. No alternate surface is used to bypass it, and no matched comparison is certified.

## Evidence and status

Run `npx playwright test --config=playwright.tab-resume.config.ts --project=loading-desktop --project=loading-mobile` for the loading cases. Set `KOVA_INTERFACE_ENGINE=firefox` or `webkit` to select the installed engine. Headed activation uses `xvfb-run -a npx playwright test --config=playwright.tab-resume.config.ts --project=native-tab-activation` on Linux.

CI retains loading and activation JSON reports in separate directories below `test-results/interface-fit/tab-resume/` so one invocation cannot overwrite the other's evidence. Attachments include raw samples, method, budgets and limitations; the existing artifact records candidate commit/tree/lock provenance.

The initial ten Chromium desktop/mobile loading cases passed locally. The first headed CI activation attempt failed because pages remained visible under Playwright's forced-focus emulation; the correction now disables that emulation. Corrected native activation and the expanded multi-engine matrix remain pending CI validation. The change has not been deployed and does not alter hosting capacity or spending limits.
