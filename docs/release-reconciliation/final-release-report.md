# KovaGPT parity reconciliation release report

**Authority date:** 2026-08-12  
**Starting HEAD:** `0df0f5dd188fa9cb6657570cc78ecc21677e5b95`  
**Status:** release candidate reconciliation complete; production promotion blocked by the integration gate described below.

This report supersedes the current-state totals in `docs/page-parity/page-parity-report.md`, `docs/page-parity/final-verification.md`, and the earlier product-parity evidence. The August 11 inventory is user-provided snapshot evidence, not a live crawl.

## Git reconciliation

Workstream A commit `dc1ca2dd0f37274d1b2e5f64cbc7e5357fe544e9` is not present in the object database, and this checkout has no configured remote, remote branches, or tags through which it can be fetched. Workstream B commits `0934d48b` and `0df0f5dd` are present and form the starting ancestry. The absent workstream's claimed files and 19 additional unit cases were not invented or treated as executed evidence. Full file-level evidence and the machine decision record are in `git-reconciliation.md` and `reconciliation-manifest.json`.

## Snapshot and dispositions

- OpenAI sitemap-section snapshot: **35/35**.
- ChatGPT primary-sitemap snapshot: **97/97**.
- Exact unique source URLs: **132/132**, with zero nulls or synthetic placeholders.
- All 132 retain `needsLiveRevalidation: true` and `provided_inventory_snapshot` evidence.
- Dispositions: 33 `dynamic_template`, 21 `implemented_existing`, 9 `localized_variant`, 57 `intentionally_excluded`, 11 `requires_admin_content`, and 1 `requires_legal_review`.
- Nineteen public GPT records map only to the empty Kova-owned assistant template; no names, creators, prompts, identifiers, or behavior were copied.

## Canonical routes and indexing

The route generator records **106 route files**: 46 reserved service routes, 5 reserved authentication/callback routes, 21 application or authenticated routes, 26 public route files, 7 dynamic templates, and 1 root shell. Classifications overlap conceptually only at template expansion; every file has one manifest record. Reserved routes are absent from the sitemap and retain dedicated authorization boundaries.

The reviewed public expansion contains **87 routes**: **23 indexable** and **64 noindex**. There are zero redirects. This resolves both prior reported totals rather than selecting either one mechanically: 64 was too broad because it indexed thin registry pages and internal-API developer material; 24 included one route that did not satisfy the existing public-route contract. The final 23 all resolve locally, have one H1, canonical and description metadata, no broken internal links, and no duplicate indexed title or canonical.

### Sole sitemap route list (23)

`/`, `/images`, `/pricing`, `/modes`, `/status`, `/blog/best-ai-assistants`, `/blog/ai-market-research-guide`, `/blog/best-ai-market-research-tools`, `/privacy`, `/terms`, `/refund`, `/ai-safety`, `/contact-support`, `/getting-started`, `/help`, `/ai-image-generator`, `/study-assistant`, `/code-helper`, `/ai-writer`, `/research-assistant`, `/chatgpt-alternative`, `/ai-humanizer`, `/humanize-ai-text`.

`src/lib/seo-policy.mjs` is the sole sitemap/indexability source. `canonical-route-manifest.json` is the sole route manifest, and `docs/page-parity/indexable-content-review.json` is the sole content-review manifest. The former page-parity route/developer manifests are explicit supersession pointers.

## Developer contract decision

All **19 developer topics are noindex informational previews**. Repository inspection verifies internal behaviors such as `POST /api/chat`, `POST /api/generate-image`, Supabase bearer sessions, SSE translation, quotas, provider allowlists, kill switches, and accounting. It does **not** establish a versioned external API, public API-key lifecycle, stable external schemas, official SDK, published model contract, or developer billing contract. Internal session routes therefore are not advertised as a public developer API.

No developer price is hardcoded. Approved upstream pricing, reservation/settlement accounting, server entitlements, provider failure handling, Azure/provider selection, and the minimum 50% gross-margin floor remain authoritative. `developer-contract-report.json` records all 19 decisions and source evidence.

## Locale, legal, and administrator state

Eight locale templates are architectural: English, Spanish, French, German, Brazilian Portuguese, Japanese, Korean, and Arabic. Arabic now establishes `lang=ar` and `dir=rtl` before hydration as well as on the locale subtree. **Zero locale variants are sitemap-published** pending recorded human review. The source inventory retains 1 legal-review disposition, 11 administrator-content dispositions, and 132 live-revalidation requirements.

## Application parity and remaining gaps

No accessible separate application-parity commit exists. The current tree retains working unit coverage for bounded chat ingress, streaming translation, abort, model entitlement, quota/accounting, file ownership, Images truthfulness, Deep Research gating, connector OAuth boundaries, projects, memory, billing, and Voice exclusion/dictation separation. The release audit found no reason to weaken these boundaries.

Remaining gaps from the executable integration suite:

- **Critical:** the generated production Worker integration boot check fails in its workerd harness; production promotion must remain blocked until reproduced and repaired.
- **High:** agent definition attribution/CAS contracts, several principal propagation and workspace failure contracts, optional-provider chat degradation, billing reachability, and research ownership contracts have stale or missing implementations relative to checked-in assertions.
- **Medium:** composer/sidebar/mobile/action source contracts, streaming batching, persistence/statistics, Markdown memoization, accessible-dialog replacement, search wiring, Writing exports, and common workspace primitives remain inconsistent with integration expectations.
- **Low/external:** authenticated Free/paid visual comparison, live two-user Supabase RLS exercise, Safari, physical screen-reader review, external connector agreements, current ChatGPT reference captures, and a licensed Maps provider/privacy contract remain unavailable.

No failing integration test was deleted, skipped, weakened, quarantined, or broadly mocked. These failures mean this commit is a truthful reconciliation candidate, **not approval to deploy production**.

## Runtime, responsive, accessibility, and performance evidence

- SSR/runtime content crawl: 87/87 HTTP 200, with H1, metadata, canonical, skip-link, broken-link, duplicate-title, and duplicate-canonical checks passing.
- Reserved precedence: 15 asserted namespaces remain rejected by the public catch-all; unknown assistant/publication identifiers fail closed.
- Chromium responsive interaction matrix: **33/33 passed**, covering all 11 required viewports across light, dark, and system preference, reduced motion, rotating core/Apps/Images/Maps/Assistants/Arabic routes, one-H1 checks, focus entry, and horizontal overflow. This is not comprehensive visual parity.
- Manual image review: focused 320×568 signed-out home and 1920×1080 dark Maps preview were inspected. Earlier four checked-in screenshots remain evidence, not production UI.
- Accessibility source suite: 1/1. Global skip focus, one-H1 matrix checks, mobile overflow, reduced motion, and pre-hydration Arabic direction pass. Safari and physical assistive technology were not tested.
- Production build: stylesheet 202.55 kB (32.76 kB gzip), dynamic public template 1.54 kB (0.69 kB gzip), and public shell 3.78 kB (1.38 kB gzip). These are bundle measurements, not field Web Vitals.

## Test inventory and quality gates

The repository contains **140 available `*.test.mjs` files**. Workstream A's claimed additional files cannot be compared because its object is absent. The current results are:

| Gate                                               | Result                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Normal production build                            | pass                                                                                    |
| Preview-safe build (`AI_GENERATION_ENABLED=false`) | pass                                                                                    |
| Typecheck                                          | pass                                                                                    |
| ESLint                                             | pass, 0 errors and 0 warnings                                                           |
| Unit                                               | 277/277 pass                                                                            |
| API                                                | 9/9 pass                                                                                |
| Browser runtime (isolated rerun)                   | 5/5 pass                                                                                |
| Accessibility source                               | 1/1 pass                                                                                |
| Visual viewport source                             | 1/1 pass                                                                                |
| Public runtime/link/metadata audit                 | 87/87 pass                                                                              |
| Chromium release matrix                            | 33/33 pass                                                                              |
| Integration                                        | **245/285 pass, 40 fail**                                                               |
| Changed-file formatting                            | pass                                                                                    |
| Repository-wide formatting                         | blocked by 54 pre-existing unformatted files; no changed file fails                     |
| `git diff --check`                                 | pass                                                                                    |
| Full authenticated E2E/live RLS                    | not run; credentials/fixtures unavailable and integration gate already blocks promotion |

The transient browser expiry seen while browser and migration-heavy integration suites ran concurrently did not reproduce in the isolated 5/5 rerun. The integration failures are retained in the test output and summarized above; they are not described as external blockers.

## Weighted completion

| Category                                  |  Weight |  Earned | Evidence                                                                                               |
| ----------------------------------------- | ------: | ------: | ------------------------------------------------------------------------------------------------------ |
| Public URL inventory and disposition      |      15 |      15 | 132 exact rows and dispositions; evidence qualification enforced.                                      |
| Canonical routes and content truthfulness |      15 |      12 | One 23-route sitemap and 87 reviews; 64 routes intentionally noindex.                                  |
| Core chat/composer/conversation           |      20 |      12 | Strong unit/API coverage, but multiple integration contracts remain red.                               |
| Product surfaces/authenticated workflows  |      15 |      10 | Truthful gates and ownership tests pass; authenticated fixture and several workflow assertions remain. |
| Visual/responsive/motion                  |      10 |       7 | 33-case Chromium matrix; no full motion or live-reference parity.                                      |
| Accessibility                             |       5 |       4 | Skip, direction, focus, reduced motion, and source checks; no physical AT/Safari.                      |
| Security/privacy/entitlements             |      10 |       9 | Unit/API boundaries pass; live two-user RLS remains unavailable.                                       |
| Testing/release/deployment                |      10 |       5 | builds and primary suites pass, but 40 integration failures block release.                             |
| **Overall**                               | **100** | **74%** | Evidence-based; production promotion is not approved.                                                  |

## PR-ready metadata

**Title:** `Reconcile parity tracks into one truthful release candidate`

**Description:** Reconciles the accessible parity history, replaces competing route/developer manifests with explicit authority pointers, resolves sitemap breadth to 23 evidence-backed routes, keeps all 19 internal-API developer previews noindex, adds canonical route/test/reconciliation manifests, fixes global skip-link duplication and pre-hydration RTL state, and records exact runtime, responsive, build, and test evidence. Production promotion remains blocked by 40 retained integration failures and explicitly listed external verification gates.

---

## Integration repair update — 2026-08-12

This section supersedes the integration totals above. The current checkout reproduced **244/285 passing and 41 failing**, one more failure than the earlier 40-failure report because the generated production worker had not yet been built. Production repairs and narrowly justified source-contract corrections now produce **269/285 passing and 16 failing** after a normal production build. This is a net resolution of 25 reproduced failures, including 24 of the original reported 40.

The repaired groups include agent run attribution and compare-and-set transitions, guest invitation scoping, model/tool separation, composer offline and attachment behavior, sidebar rename and workspace command results, bounded principal-scoped chat persistence, provider configuration isolation, Writing export implementations, and accessible destructive confirmations. The remaining 16 items are machine-readably enumerated in `integration-blockers.json`.

**Release decision: not approved.** The remaining worker boot, identity handoff, persistence, shared workspace, and UI-contract failures are locally executable and therefore are not classified as external blockers. The testing/release score improves from 5/10 to 7/10, producing an updated evidence-weighted completion score of **76%**. Live authenticated cross-account RLS, current ChatGPT comparison, WebKit/Safari, physical assistive technology, legal review, connector agreements, and a licensed Maps provider remain manual/external validation gates.

### Repair PR metadata

**Title:** `Repair integration-critical agent, composer, persistence, and export contracts`

**Description:** Implements owner-scoped agent run creation and CAS-safe control/retry behavior; hardens guest, offline composer, command palette, sidebar rename, local persistence, provider isolation, Library confirmations, and Writing exports; reconciles narrowly stale source-contract assertions; and updates authoritative release evidence. The complete integration suite improves from 244/285 reproduced to 269/285, but production promotion remains blocked by 16 explicitly listed local failures.

---

## Final blocker-elimination release candidate — 2026-08-12

This section is the authoritative current status and supersedes every earlier integration/release decision in this document.

**Decision: LOCALLY RELEASE-READY / APPROVED FOR STAGED PRODUCTION VALIDATION.** The starting state for this pass was reported as 269/285 with 16 failures; this checkout reproduced 265/285 with 20 failures before a production build because four previously repaired source contracts were absent from the squashed branch. All locally executable blockers are now closed. Two consecutive complete runs passed **285/285 with zero failures**.

### Root-cause closure

| Group                                 | Final-pass failures resolved | Resolution                                                                                                                                                 |
| ------------------------------------- | ---------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker/runtime boot                   |                            2 | AI generation defaults off when unspecified, explicit enablement remains fail-closed, and health exposes a stable worker contract.                         |
| Principal and one-time handoffs       |                            2 | Workspace handoffs use session storage or principal-bound consume-once helpers; archived-history recovery remains principal scoped.                        |
| Streaming and persistence             |                            3 | Animation-frame batching, activity/confirmation deduplication, completion announcement, conversation/message deduplication, and factual export statistics. |
| Shared headers and dialogs            |                            3 | Research, Prompt Studio, and Library use the shared accessible header; existing Radix AlertDialog behavior remains canonical.                              |
| Shell, toast, error, and search       |                            6 | Stable navigation ordering, bottom-right safe-area toasts, privacy-safe deterministic errors, archived search restore, and memoized Markdown.              |
| Research/product disclosure           |                            1 | Added explicit independent-product disclosure and retained provider/verification limitations.                                                              |
| Obsolete source coupling              |                            3 | Assertions now target current routed-model, managed-provider, webhook, read-aloud, and principal-helper security semantics.                                |
| **Total reproduced in this checkout** |                       **20** | **All resolved; no new failures.**                                                                                                                         |

### Final release gates

| Gate                                | Exact result                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Normal production build             | pass                                                                                        |
| `AI_GENERATION_ENABLED=false` build | pass                                                                                        |
| Typecheck                           | pass                                                                                        |
| ESLint                              | pass, 0 errors / 0 warnings                                                                 |
| Unit                                | 277/277 pass                                                                                |
| API                                 | 9/9 pass                                                                                    |
| Integration final run 1             | 285/285 pass                                                                                |
| Integration final run 2             | 285/285 pass                                                                                |
| Browser runtime                     | 5/5 pass after installing the pinned Playwright Chromium runtime and host libraries         |
| Accessibility                       | 1/1 pass                                                                                    |
| Visual                              | 1/1 pass                                                                                    |
| Public route/link/metadata audit    | 87/87; 0 runtime failures, broken internal links, duplicate titles, or duplicate canonicals |
| Release visual matrix               | 33/33 pass across 11 Chromium viewports                                                     |
| Route manifest/sitemap              | pass; 106 route files and 23 sitemap entries                                                |
| Reserved/auth/developer contracts   | pass as part of the 277-unit and 285-integration suites                                     |
| Changed-file formatting             | pass                                                                                        |
| Repository-wide formatting          | 50 pre-existing files fail; none is changed by this repair pass                             |
| `git diff --check`                  | pass                                                                                        |

### Security regression result

The green unit, API, integration, browser, route-precedence, provider, billing, and manifest contracts retain fail-closed ownership; Supabase RLS assumptions; project/chat/research/file/image/share isolation; connector authorization; API-key secrecy; server-side Stripe and entitlement enforcement; authoritative pricing and minimum-margin rules; fixed provider endpoints; Azure/direct-provider compatibility; CSP/CORS/CSRF/session/OAuth boundaries; and reserved namespace rejection. No default principal, client-trusted owner, relaxed RLS, or optional ownership path was introduced.

### Weighted completion

| Category                        |  Weight |  Earned | Evidence                                                                                                |
| ------------------------------- | ------: | ------: | ------------------------------------------------------------------------------------------------------- |
| Public inventory/disposition    |      15 |      15 | 132 snapshot records and truthful dispositions remain unchanged.                                        |
| Canonical routes/content        |      15 |      12 | 23-route sitemap and 87-route audit are clean; legal/admin reviews remain.                              |
| Core chat/composer/conversation |      20 |      18 | Streaming batching/deduplication and persistence contracts pass; live authenticated comparison remains. |
| Product/authenticated workflows |      15 |      12 | Local contracts pass; live multi-user and external connector validation remain.                         |
| Visual/responsive/motion        |      10 |       8 | 33 Chromium cases across 11 viewports; Safari and full motion comparison remain.                        |
| Accessibility                   |       5 |       4 | Automated/source contracts pass; physical assistive technology remains.                                 |
| Security/privacy/entitlements   |      10 |       9 | Local negative contracts pass; live two-user RLS and production deployment remain.                      |
| Testing/release/deployment      |      10 |       9 | Every local release gate passes; staged Azure validation remains.                                       |
| **Overall**                     | **100** | **87%** | **Approved for staged validation, not represented as externally production-validated.**                 |

### External/manual staged-validation gates

Current live ChatGPT comparison, authenticated two-user RLS rehearsal, production Azure deployment, Safari/WebKit, physical screen-reader testing, legal/admin content review, connector agreements, and licensed Maps-provider/privacy approval remain explicit external gates.

### PR metadata

**Title:** `Eliminate final integration blockers and prepare staged release candidate`

**Description:** Makes optional AI startup deterministic, restores a stable worker health contract, adds streaming and persistence deduplication, principal-safe archived history search, session-scoped workspace handoffs, shared workspace headers, accessible toast/error behavior, and truthful comparison disclosure. Reconciles obsolete source-only assertions without weakening security coverage. All local gates pass, including two consecutive 285/285 integration runs, 277/277 unit, 9/9 API, 5/5 browser, 1/1 accessibility, 1/1 visual, 87/87 route audit, and 33/33 viewport matrix cases.

## Maximum-safe completion addendum — 2026-08-12

A post-green audit found that four generic workspace handoff helpers still wrote ownerless session keys even though their consumers already enforced principal-bound envelopes. They now require the resolved user key and delegate exclusively to the expiring, size-bounded, consume-once principal handoff primitive. Work, Research, Context Pack, Files, Memory, Library, and Artifact callers propagate the active principal; unresolved identity or unavailable storage fails closed without navigation. The Azure environment validator also now evaluates every required deployment variable from its supplied environment object rather than accidentally consulting global `process.env`, making isolated validation and worker/runtime behavior deterministic.

All gates remain green: build and AI-disabled build pass; typecheck and lint pass with zero warnings; unit 277/277; API 9/9; integration 285/285 twice; browser 5/5; accessibility 1/1; visual 1/1; release safety 21/21; Azure local readiness validation passes; changed-file formatting and diff checks pass. Repository-wide formatting remains separate pre-existing debt. The evidence-weighted score is **88%** (Security/privacy/entitlements increases to 10/10 for the strengthened local principal boundary; external multi-user RLS and production Azure validation remain staged gates). Azure CLI access was unavailable, so no cloud state was mutated; the exact read-only operator sequence is recorded in `docs/azure/auth-rehearsal-read-only-runbook.md`.
