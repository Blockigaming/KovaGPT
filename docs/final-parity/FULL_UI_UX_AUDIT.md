# KovaGPT full UI/UX parity and product-surface audit

**Audit date:** 2026-08-28  
**Verdict:** **Not ready for the finalized goal.** The locally rendered product is broad, coherent and generally truthful, but core provider-backed and authenticated workflows are not fully proven, Work and Scheduled Tasks explicitly cannot execute, Maps is a non-map preview, and production was not tested. A conservative estimate is **62% UI/UX completion** toward the stated goal—not 62% code completion.

## Truth boundary

This report distinguishes **observed**, **source-supported**, and **not verified**. It does not turn route existence, unit assertions, local mocks, or emulated viewports into a production claim.

- **Observed locally:** the prebuilt preview; 47 user-facing routes; signed-out rendering; light/dark color schemes; the eight required widths; Chromium, Firefox and WebKit/Safari-equivalent engines; keyboard/focus browser checks; local failure/empty states reachable without real accounts.
- **Source-supported, not treated as completion:** server error mappings, entitlement gates, persistence code, connector state models, billing contracts, and test fixtures.
- **Not verified:** production, a real signed-in session, Plus/Pro entitlement transitions, two-user ownership isolation, real OAuth providers, real Stripe payments/webhooks, real AI/image/search streams, physical Safari/iOS/Android, or screen readers. `productionVerified` is therefore `false` for every matrix row.
- **Rendered crawl evidence:** 365 engine/route/viewport/theme records completed with zero navigation failures, zero HTTP error documents and zero document-level horizontal-overflow instances. The crawl captured 17 Work render TypeErrors, one Audit Log render TypeError, 28 unnamed interactive instances, and 1,794 repeated interactive instances below 24 px. External TLS/proxy failures dominated other console errors and are classified as environment/provider evidence rather than silently ignored.
- **No fake-control count inflation:** this audit found **0 directly demonstrated clickable controls that silently did nothing** in the locally reachable signed-out UI. Disabled/unavailable controls were generally labelled truthfully. That does **not** mean authenticated controls are cleared.
- **Parity meaning:** “approximately 75% familiar” is conceptual. OpenAI proprietary infrastructure, private ranking, model internals and assets are not reproducible targets. The closest sound Kova equivalent must be independently implemented and labelled.

## Executive summary

| Measure                                      |                                                        Result |
| -------------------------------------------- | ------------------------------------------------------------: |
| Routes audited                               |                                                        **47** |
| Product surfaces audited                     |                                                        **22** |
| P0                                           |                                                         **0** |
| P1                                           |                                                        **10** |
| P2                                           |                                                        **15** |
| P3                                           |                                                         **4** |
| Directly verified dead/fake visible controls |                                                         **0** |
| Missing major surfaces                       |                **1** (sandboxed data-analysis/code execution) |
| Accessibility defects/gaps                   | **2** (rendered naming/target class plus AT verification gap) |
| Responsive defects/gaps                      |                      **1** systemic real-device/safe-area gap |
| Browser-specific defects                     |                                     **1** directly reproduced |
| Estimated remaining UI/UX completion         |                              **62% complete / 38% remaining** |
| Production verified                          |                                                        **No** |

P0 is zero because the audit did not directly reproduce data loss, cross-tenant disclosure, account takeover, or an entirely unavailable primary product. The absence of a reproduced P0 is not a security certification.

## Routes actually loaded

The route crawl loaded these user-facing paths rather than merely reading the generated router:

`/`, `/ai-humanizer`, `/ai-image-generator`, `/ai-safety`, `/ai-writer`, `/apps`, `/assistants`, `/audit-log`, `/auth`, `/brain`, `/changelog`, `/chatgpt-alternative`, `/code-helper`, `/connect`, `/contact-support`, `/context-packs`, `/files`, `/getting-started`, `/goals`, `/help`, `/humanize-ai-text`, `/images`, `/knowledge-graph`, `/library`, `/maps`, `/mcp`, `/memory`, `/modes`, `/notifications`, `/omega`, `/pricing`, `/privacy`, `/projects`, `/prompt-studio`, `/refund`, `/research-assistant`, `/research-planner`, `/reset-password`, `/scheduled-tasks`, `/status`, `/study-assistant`, `/summary`, `/terms`, `/unsubscribe`, `/work`, `/write`, and `/developers/`.

Parameterized `/chat/$chatId`, `/projects/$projectId`, project chat, assistant detail, OAuth consent/callback and checkout-return routes were inspected through existing automated fixtures and source contracts where possible, but were **not** counted as independently production-verified journeys.

## Render matrix

- Widths/heights: **320×700, 375×812, 390×844, 768×1024, 1024×768, 1280×800, 1440×900, 1728×1117**.
- Engines: **Chromium, Firefox, WebKit**. WebKit is only a Safari-equivalent engine in Linux; it is not macOS/iOS Safari certification.
- Themes: **light and dark** via browser color-scheme emulation.
- Auth: **signed out rendered**; **signed in not credential-verified**. Tests that inject or mock identities are not equivalent to a live session.
- Workflow states: empty and unavailable states were extensively visible. Success, partial success, offline, expiry, permission, rate-limit, retry and cancellation were accepted only when actually reached by a browser or explicitly reported as unverified.

## Product-surface matrix

Legend: “No” means missing, explicitly unavailable, or insufficiently verified—not necessarily absent source code.

| Surface                        | Exists | Functional | Polished | Responsive | Accessible | Failure states | Backend truthful | Tested | Production verified |
| ------------------------------ | ------ | ---------- | -------- | ---------- | ---------- | -------------- | ---------------- | ------ | ------------------- |
| Core chat                      | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Search / Deep Research         | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Projects                       | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Files                          | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Library                        | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Images                         | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Artifacts / Canvas equivalent  | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Work / agents                  | Yes    | **No**     | No       | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Scheduled Tasks                | Yes    | **No**     | No       | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Apps / connectors              | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Custom Kovas / assistants      | Yes    | No         | Yes      | Yes        | No         | No             | No               | Yes    | **No**              |
| Memory / personalization       | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Data analysis / code execution | **No** | No         | No       | No         | No         | No             | Yes              | No     | **No**              |
| Maps / rich responses          | Yes    | **No**     | Yes      | Yes        | Yes        | Yes            | Yes              | Yes    | **No**              |
| Settings                       | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Auth                           | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Billing                        | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Developer / platform           | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Public / legal / support       | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Navigation / IA                | Yes    | Yes        | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Notifications                  | Yes    | No         | Yes      | Yes        | No         | Yes            | Yes              | Yes    | **No**              |
| Study                          | Yes    | No         | Yes      | Yes        | No         | No             | Yes              | Yes    | **No**              |

## Major conclusions and exact evidence

### 1. The UI is broad, but execution depth—not page count—is the release blocker

The route tree and rendered crawl show substantial Kova-owned breadth. However, the Work UI directly says agent execution is unavailable, including disabled approval; Scheduled Tasks directly says background execution is unavailable; and the agent browser surface says secure browser runs are unavailable while the execution service is rebuilt. These are truthful states, but they prevent functional parity.

### 2. Maps is truthful but not functionally equivalent

Maps is deliberately a privacy/product-decision preview with no licensed map canvas, markers, directions or location request. That is safer than a fake map, but it is not a rich map-response surface.

### 3. Primary chat success under real provider timing is still unproven

The implementation has error mapping and synthetic coverage, but this audit did not witness a real first token, partial stream, abort race, persisted partial response, rate limit, provider timeout, stop, retry or regeneration against a staging provider. Therefore Core Chat cannot be marked fully functional.

### 4. Authenticated breadth is not verified

Projects, Library, Files, Memory, Apps, assistants, settings, billing, history and collaboration depend on identity and stored data. The release configuration itself refuses an authenticated matrix without a supplied storage state. No such state was provided. This is the most important evidence boundary in the report.

### 5. Accessibility and mobile confidence are test-level, not certification-level

The codebase includes focus restoration and visible-focus browser assertions, reduced-motion configuration, labels and operational-state patterns. No screen reader or physical phone was used. Playwright WebKit on Linux and viewport emulation cannot validate Safari keyboard resizing, notches, IME behavior, device font scaling or VoiceOver.

### 6. Rendered reliability has two concrete data-shape failures

The actual crawl found repeated `map is not a function` exceptions in Work and one in Audit Log. Both documents returned successful HTTP responses, proving route/status smoke is insufficient. The same crawl found no document-level horizontal overflow, but it did find unnamed and sub-24 px interactive instances that require selector-level deduplication and manual accessibility triage.

### 7. Truthfulness is stronger than completeness

Unavailable providers are generally called unavailable, and intentionally absent voice behavior is enforced rather than represented by a dead microphone. No directly demonstrated silent dead button was counted. Conversely, strict Lovable independence is incomplete because legacy `.lovable` and `/lovable/email/*` compatibility namespaces remain in the generated route tree, even if they are not primary visible navigation.

## Gap register

The authoritative machine-readable issue records—with viewport, browser, theme, auth, state, evidence, source files, impact, fix and `verifiedFixed: false`—are in [`FULL_UI_UX_AUDIT.json`](./FULL_UI_UX_AUDIT.json). The 29 issues are:

| ID           | Severity | Surface                | Finding                                                                   |
| ------------ | -------- | ---------------------- | ------------------------------------------------------------------------- |
| KOVA-AUD-001 | P1       | Release verification   | Production and authenticated product are not verified                     |
| KOVA-AUD-002 | P1       | Work / agents          | Long-running execution is explicitly unavailable                          |
| KOVA-AUD-003 | P1       | Scheduled Tasks        | Scheduled execution is unavailable                                        |
| KOVA-AUD-004 | P1       | Maps                   | Maps is an education preview, not a functional map response               |
| KOVA-AUD-005 | P1       | Browser / Work         | Secure browser automation is unavailable                                  |
| KOVA-AUD-006 | P1       | Billing                | Real checkout lifecycle is not end-to-end verified                        |
| KOVA-AUD-007 | P1       | Projects               | Role and tenant-isolation UX is not rendered under multiple principals    |
| KOVA-AUD-008 | P1       | Core chat              | Real streaming interruption/provider failures are not end-to-end verified |
| KOVA-AUD-009 | P1       | Images                 | Provider and moderation lifecycle is not verified                         |
| KOVA-AUD-010 | P2       | Auth                   | Authentication recovery matrix is incomplete                              |
| KOVA-AUD-011 | P2       | Apps                   | Connector lifecycle is only partially verifiable locally                  |
| KOVA-AUD-012 | P2       | Data analysis          | No independently verified sandboxed code-execution workflow               |
| KOVA-AUD-013 | P2       | Artifacts              | Full persistence/recovery proof is absent                                 |
| KOVA-AUD-014 | P2       | Files / Library        | Ownership, large-file and unsupported-file behavior is unverified         |
| KOVA-AUD-015 | P2       | Memory                 | Temporary Chat and memory lifecycle is not end-to-end verified            |
| KOVA-AUD-016 | P2       | Assistants             | Authoring and publishing parity is incomplete                             |
| KOVA-AUD-017 | P2       | Research               | Success, partial, cancel and failure states are not live-verified         |
| KOVA-AUD-018 | P2       | Accessibility          | Automated smoke checks do not establish screen-reader accessibility       |
| KOVA-AUD-019 | P2       | Responsive             | Device-browser and safe-area verification is incomplete                   |
| KOVA-AUD-020 | P2       | Navigation / branding  | Lovable-named compatibility routes remain shipped                         |
| KOVA-AUD-021 | P3       | Voice                  | No voice conversation/read-aloud surface                                  |
| KOVA-AUD-022 | P3       | Enterprise             | Advanced administration is absent                                         |
| KOVA-AUD-023 | P3       | Study                  | Focused prompt surface is not a verified adaptive study system            |
| KOVA-AUD-024 | P3       | Status/support         | Production-backed delivery was not verified                               |
| KOVA-AUD-025 | P2       | Secure browser runtime | Chromium expiry cleanup is timing-sensitive                               |
| KOVA-AUD-026 | P2       | Release UI harness     | Responsive selectors are stale or ambiguous                               |
| KOVA-AUD-027 | P1       | Work                   | Repeated non-array render TypeError                                       |
| KOVA-AUD-028 | P2       | Audit Log              | Non-array render TypeError                                                |
| KOVA-AUD-029 | P2       | Accessibility          | Unnamed and undersized interactive instances need triage                  |

## Highest-impact 20 fixes, in order

1. Create seeded, disposable staging identities for signed-out, free, Plus and Pro states.
2. Add two tenants with owner/editor/viewer roles and run direct-URL and realtime isolation tests.
3. Restore the isolated Work runner with authoritative progress, cancel, pause, retry and audit history.
4. Back Scheduled Tasks with a real scheduler, entitlement enforcement and execution/delivery history.
5. Fault-inject real chat streams after the first token and verify stop/partial persistence/retry races.
6. Run a real image-provider matrix: accepted, moderated, timeout, unavailable, edit and retry.
7. Run a real Deep Research matrix with sources, partial persistence, cancellation and provider failure.
8. Complete Stripe test-mode checkout, webhook delay, payment failure, cancellation, downgrade and recovery.
9. Run Google/GitHub OAuth scope, expiry, revoke, reauthorize, sync and outage flows.
10. Implement or explicitly exclude sandboxed data analysis/code execution with truthful capability copy.
11. Prove File/Library upload boundaries, MIME spoofing, extraction failure, removal races and ownership.
12. Prove Memory enable/disable and Temporary Chat no-read/no-write behavior across sessions.
13. Complete artifact create/edit/version/restore/Library/Work/Research handoffs with storage fault injection.
14. Decide whether assistants are read-only; otherwise ship authoring, knowledge, capability and publishing states.
15. Add a licensed accessible map provider and list fallback, or remove Maps from product navigation.
16. Remove Lovable compatibility namespaces after consumers are migrated and tombstones expire.
17. Run NVDA, VoiceOver and TalkBack audits of chat, dialogs, projects, billing and failure recovery.
18. Run physical iOS/Android tests with open keyboard, rotation, safe areas, zoom and 200% text.
19. Connect public status to independent telemetry and verify support ticket delivery.
20. Execute a non-mutating production smoke after staging passes; keep every `productionVerified` flag false until then.

## ChatGPT/OpenAI conceptual familiarity assessment

| Reference concept      | Closest Kova equivalent                  | Conservative disposition                                              |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Chat                   | `/`, `/chat/$chatId`                     | Familiar shell; real provider interruption matrix unverified          |
| Search                 | chat search/web-search tools             | Exists; real citations/provider failures unverified                   |
| Deep Research          | `/research-planner`                      | Planner exists; paid live run unverified                              |
| Images                 | `/images`                                | Strong surface breadth; provider lifecycle unverified                 |
| Files                  | `/files`, `/library`                     | Present; ownership and boundary behavior unverified                   |
| Projects               | `/projects`, detail/chat routes          | Broad; multi-principal permissions unverified                         |
| Memory                 | `/memory`, Settings                      | Present; Temporary Chat interaction unverified                        |
| Temporary Chat         | composer/chat mode                       | Exposed; no authenticated persistence proof                           |
| Scheduled Tasks        | `/scheduled-tasks`                       | **Explicitly non-executing**                                          |
| custom GPTs            | `/assistants`, assistant detail          | Discovery/detail exists; author/publish gap                           |
| Apps/connectors        | `/apps`, Settings Apps                   | Google/GitHub-oriented; real OAuth lifecycle unverified               |
| Canvas/artifacts       | `/write`, Artifact Editor                | Meaningful Kova equivalent; cross-surface recovery unverified         |
| Study                  | `/study-assistant`                       | Prompt-focused approximation, not proprietary adaptive infrastructure |
| Data analysis          | attachments/charts                       | Missing a verified isolated execution equivalent                      |
| Settings/notifications | Settings dialog, `/notifications`        | Broad, but authenticated effects unverified                           |
| Account/auth           | `/auth`, reset/MFA dialogs               | Signed-out shell present; lifecycle incomplete                        |
| Plan/billing           | `/pricing`, checkout return, Settings    | UI/contracts present; real lifecycle unverified                       |
| Help/support           | `/help`, `/contact-support`, legal pages | Broad; production delivery unverified                                 |
| Developer/platform     | `/developers/`, `/mcp`, OAuth consent    | Exists; authenticated key/consent error matrix unverified             |
| Voice                  | intentionally absent                     | Truthful exclusion; familiarity gap                                   |

OpenAI-only private infrastructure is not treated as something Kova can or should copy. The audit evaluates whether an independently built, technically sound Kova equivalent exists and works.

## Test execution and classification

The audit did not stop after a first failure. It ran build, static checks, unit, API, integration, accessibility-source, visual-config and release tests, then browser matrices. The isolated Chromium 320 release project failed 3/3 checks because its top-bar locator was ambiguous and its expected send-button test hook was absent, even though the failure screenshot showed the visible send control. Browser installation initially hit a 403 on the primary Playwright CDN but succeeded through Playwright's Microsoft fallback; host dependencies were installed in this isolated container. Detailed pass/fail totals are preserved in the command output used to produce this report.

A passing source/config test means only what it asserts. For example, the visual test verifies that required viewports are named; it does not itself prove pixels are correct. Likewise, the one a11y Node test is not a screen-reader audit.

## Release decision

**No-go for the finalized goal.** KovaGPT should not be called production-ready or fully parity-complete until at least KOVA-AUD-001 through KOVA-AUD-009 are closed with staging evidence, the P2 authenticated and accessibility matrices are substantially completed, and a separate non-mutating production verification is recorded. The current product deserves credit for breadth and truthful unavailable states, but those strengths do not substitute for functional core journeys.
