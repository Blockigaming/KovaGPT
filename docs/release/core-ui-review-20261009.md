# Core UI review — 2026-10-09

This source candidate updates the shared KovaGPT interface on top of PR #445 base
`0f0914019ec5674e78caa65589bde7f84b65c2ce`. The final published commit is recorded in the
accompanying external evidence after publication. This record does not certify an
older, unavailable working copy.

## Scope and preserved contracts

- Shared dark default, explicit light/system preferences, responsive sidebar, compact
  chat rows, rounded controls, a one-line composer that grows with its content, and
  the original KovaGPT logo.
- Responsive attachment menus, saved Library selection, drawing attachments, and
  identifiable plugin links with actual connection status and permission boundaries.
- Consistent Library, Images, Projects, Tasks, Plugins, Settings, authentication,
  pricing, help and legal surfaces. Task shortcuts remain limited to signed-in Plus
  and Pro accounts; unavailable services retain truthful states.
- Chat rename, duplicate, archive, delete, Undo and project-copy controls use existing
  persistence APIs. Account changes discard stale UI responses; competing history
  mutations are guarded; temporary chats are excluded from durable history payloads.
  Project copying discloses member visibility and omitted attachments.

The diff preserves the original logo files, server/provider and authentication
contracts, migration bodies, package dependencies, deployment workflows, plan prices,
and legal text. No preview fixtures or demo accounts were added to customer product
source. The review harness uses isolated synthetic data and blocks external writes.

## Validation of the recovered candidate

| Check                                | Result and qualification                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full unit invocation                 | 3,527 passed of 3,544; 17 initial failures, all resolved by focused reruns below. A second clean full-unit run is not claimed.                                                                                                                                        |
| API suite                            | 9/9 passed.                                                                                                                                                                                                                                                           |
| Focused updated fixtures             | 94/94 passed across 15 files.                                                                                                                                                                                                                                         |
| Final typecheck                      | Passed (`npm run typecheck`).                                                                                                                                                                                                                                         |
| Changed-file ESLint and Prettier     | Passed for changed and untracked supported files; Python caches excluded. The final outline-button and browser-fixture edits were rechecked.                                                                                                                          |
| Production Node browser matrix       | Chromium: four account/theme/viewport cases, 61 fresh captures, zero recorded page errors or assertion failures.                                                                                                                                                      |
| Bounded production E2E               | 38 passed, zero failed, two intended desktop viewport skips; Chromium with one fresh browser per case and Liberation Sans 2.1.5.                                                                                                                                      |
| Core shell pixel baselines           | Eight baselines visually inspected and updated, then 8/8 verified again against the final outline-button source in fresh browsers.                                                                                                                                    |
| Authentication visual/security cases | 2/2 passed against the final source after visual review and updates to exactly two baseline PNGs.                                                                                                                                                                     |
| Isolated source review               | Chromium: 74 cases and 86 fresh captures; zero recorded failures, page errors, external requests or overflow findings.                                                                                                                                                |
| Default Cloudflare build             | Passed after a clean rebuild with `NODE_OPTIONS=--max-old-space-size=8192`; source/build audit passed for 795 bundle files with zero source maps or audit warnings. Initial default-heap invocation exhausted V8 memory. The final cosmetic-edit rebuild also passed. |
| Cloudflare bundle budget             | All four tracked bundles passed again after the final cosmetic-edit rebuild.                                                                                                                                                                                          |
| Integration suite                    | Initial invocation: 499/503 passed. Three stale source assertions were updated; their files passed 9/9 focused tests. One workerd startup test remains blocked by this host.                                                                                          |

The initial unit failures were resolved without relaxing production protections:

- Four canonical-history and ten upgrade-history failures came from two missing Git
  blobs in the reconstructed checkout. Fetching those exact objects restored the
  unchanged pinned history fixtures; their files then passed 7/7 and 11/11 tests.
- Two Sidebar fixture failures required current media event APIs and explicit Free
  versus Plus account fixtures. The updated file passed 5/5, retaining paid-task gates.
- One connector-runtime test file failed as a process during the parallel full run.
  Its isolated rerun passed 14/14; the full-run log does not establish an exact cause.

The integration fixture updates preserve principal ownership checks while recognizing
an added account dependency, the acknowledged history save's snapshot argument and
Timer controls positioned in the normal utility row. The production Worker artifact
check passes. The separate workerd boot test fails before startup because Wrangler's
network-interface enumeration returns `uv_interface_addresses: Unknown system error 1`.
That test remains unchanged; a clean full integration pass is not claimed.

Additional targeted coverage checks acknowledged history actions, theme defaults,
recovery feedback, account changes, project copying, and drawing refusal. The browser
UI assertions now cover one-line/multiline growth, circular controls, visible focus
without glow, responsive menus, viewport containment, Escape focus return and wrapped
starter prompts. The eight changed core-shell baselines were reviewed before their
verification rerun.

The production browser run uses the actual Node bundle with isolated synthetic
network responses for guest, Free, Plus and Pro accounts. It covers desktop, phone,
tablet and landscape geometry, direct routes, refresh/back/forward, sidebar dismissal,
swipe access, attachment choices and Settings control geometry. Expected fixture 503
responses and blocked external requests are recorded separately; this is not proof
of live sign-in, billing, provider actions or production data persistence.

The production Node matrix, original bounded E2E and integration runs preceded the
final one-line cosmetic change from a translucent outline-button background to
transparent. The final eight core-baseline cases, two authentication cases, isolated
source review and Cloudflare rebuild cover that edit; no behavior or server contract
changed.

The isolated authentication fixture used the unchanged installed dependencies after
its initial dependency-install attempt failed. Its final build and both unchanged
visual/security test cases passed, and the candidate Cloudflare artifact fingerprint
was identical before and after this isolated check.

Firefox's isolated probe exceeded its deadline; WebKit could not launch because host
libraries were missing. Neither is counted as passing, and no real iOS/Safari hardware
certification is claimed.

## Evidence and publication boundary

The accompanying evidence includes `core-ui-browser/audit.json` (the earlier
61-capture run; those superseded images are excluded), `core-ui-review/audit.json`,
its 86 final source-review captures, `core-ui-review/engine-recheck.json`,
`core-ui-e2e-final-evidence.json`, `core-ui-final-baselines/results.json`,
`core-ui-auth-visual/results.json`, `core-ui-fresh-recheck/results.json`, the final typecheck/build logs, and the unit/API/
integration logs. Local diagnostic log basenames include
`kova-reconstructed-unit.log`, `kova-reconstructed-api.log`,
`kova-reconstructed-fixtures2.log`, `kova-canonical-recovered.log`,
`kova-upgrade-canonical-recovered.log`, `kova-sidebar-final-fixture.log`,
`kova-launch-connector-isolated.log`, `kova-final-lint.log`,
`kova-final-format.log`, `kova-reconstructed-integration.log`,
`kova-integration-focused-final.log`, `kova-final-worker-artifact.log` and
`kova-cloudflare-bundle-budget.log`.

Source publication is limited to the existing PR branch while preserving its current
descendants. It does not perform a merge, force-push, deployment,
provider mutation or purchase. The Azure deployment workflow remains manually gated.
