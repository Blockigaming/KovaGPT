# Settings UX source-contract maintenance

Date: 2026-10-19, approximately 09:58 UTC. Production source: `765eba61096649ee575857124b7fec97ca4da093`. SettingsDialog SHA-256: `e3f90fb7e87005d15d42d038c0a294a349854e9597ad726cf607f103100d8b10`.

## Scope and terminal results

Only `tests/integration/settings-ux-contract.test.mjs` was run, serially, using `node --test tests/integration/settings-ux-contract.test.mjs`.

- Before: exit 1; 11 tests; 8 passed, 3 failed, 0 skipped.
- After: exit 0; 11 tests; 11 passed, 0 failed, 0 skipped.
- This change touches the named test and this evidence file only. No production-source fix was needed or made. No broader suite, typecheck, build, browser, or live-service call was performed.
- Source-executed handlers use explicit in-memory dependencies; they do not create a billing session or navigate a real browser. Static native-label association is not browser accessibility-tree evidence.

## Classification, with history

### 1. Response tone accessible name

Old test lines 26–35 required the literal `aria-label="Response tone"` anywhere in SettingsDialog. That applied to the old Radix select for `settings.mood`. Commit `e38c31f` replaced this with the current native `select` bound to `settings.responseTone`, directly nested in a visible `label` containing Tone (`src/components/SettingsDialog.tsx:1065–1081`). Native implicit labeling preserves the meaningful accessible association without requiring that ARIA attribute.

Owner requirements 168 and 323 call for Direct/Formal/Conversational tone choices, Direct default, and response defaults in Settings. The repaired test requires exactly one current tone select, verifies its enclosing label and visible text, exact option values/labels, real default, and executes its actual change handler for all choices while checking unrelated settings remain intact. Other named-control and language assertions are retained. Classification: superseded control/label implementation, not evidence of an unlabeled control.

### 2. General navigation category

Old test lines 51–79 expected `General` and `Personalization` labels. Commit `638a162` deliberately relabeled those navigation entries to Responses and Profile at `SettingsDialog.tsx:219–220`. The underlying tab values remain general/personalization; `SETTINGS_SECTIONS` maps the stable responses/profile routes to them. Page navigation and route mapping were introduced in `e38c31f`. This follows the current Profile/Responses organization in owner requirements 304/323.

The repaired test reads the actual centralized registry, preserves all 20 dialog category checks with current names, and requires exactly one corresponding rendered panel per category. It executes the real section resolver, checks all eight page-route keys and their reverse mapping/panels, and retains the actual Tabs and navigation callback assertions. Classification: superseded display labels; no lost category or route was exposed.

### 3. Billing portal loading guard

Old test lines 167–177 required a single-line if expression beginning with portalLoading and exactly three operands. The actual guard (`SettingsDialog.tsx:522–531`) is multiline and also blocks closed Settings, signed-out users, and an already pending request. Git blame assigns all guard lines to restored baseline `eaaddce`; a read-only literal check of that historical source confirms the strict old regex was already false there. The exact same three old assertions also evaluate false against `6aac626`, so the subsequent Memory Center link commit did not introduce them. These are source-content comparisons, not historical runtime test reruns.

Owner requirements 8/340 require preserving authoritative billing behavior and using the supported management flow. The repaired test executes the actual current handler under seven deny states: closed, signed out, pending ref, loading state, absent summary, no billing account, unavailable portal. Each must produce no request, loading event, or navigation. An eligible case must issue exactly one request and navigate only to the real allowlisted URL. Unsafe URL and provider-error cases must show the bounded error and release loading without navigation, using the real shared URL validator. The existing URL-validation call and inherited-subscription UI guard assertions remain. Classification: over-specific stale source regex; the safety gates were present and are now behaviorally checked.

## Conclusion and evidence boundaries

The exact file is green after test maintenance, with no actual production regression exposed by these three failures. This is not a full-suite-green, billing-provider, browser accessibility, or complete Settings acceptance claim.

Persisted logs are in the sibling `kova-spec400-exports/` directory:

- Before: `settings-ux-source-before-765eba6.log`; SHA-256 `7bf2d522c052826c1216742c43ea07d5f2e2ebcac937ca2dd0e61ef156c3c675`.
- After: `settings-ux-source-after-765eba6.log`; SHA-256 `4e4ae9387e4d2362e94389bbeacb680c9ca5f907eaf3e1376dc65884bc4362d8`.

Exit codes are recorded from terminal execution. The after log corresponds to the test content committed with this document. The retained earlier broad-suite cancellation and unrelated test groups are not reclassified by this bounded result.
