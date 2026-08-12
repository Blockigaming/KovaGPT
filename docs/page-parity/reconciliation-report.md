# KovaGPT dated-snapshot reconciliation report

## Snapshot evidence

This report reconciles the exact inventory embedded in the task prompt. It is a dated August 11, 2026 snapshot, not a live crawl. Every record has `evidenceQuality: "provided_inventory_snapshot"` and `needsLiveRevalidation: true`.

| Inventory measure                           | Exact result |
| ------------------------------------------- | -----------: |
| Appendix A OpenAI sitemap sections imported |      35 / 35 |
| Appendix B ChatGPT primary URLs imported    |      97 / 97 |
| Exact unique source URLs                    |          132 |
| Exact one-to-one dispositions               |    132 / 132 |
| Synthetic or `source_unavailable` URLs      |            0 |
| OpenAI `sitemap_section` rows               |           35 |
| ChatGPT product roots                       |            1 |
| ChatGPT locale roots                        |           63 |
| ChatGPT public GPT details                  |           19 |
| ChatGPT GPT directories                     |            1 |
| ChatGPT image surfaces                      |            1 |
| ChatGPT shopping surfaces                   |            1 |
| ChatGPT translation rows                    |           10 |
| ChatGPT paraphrasing rows                   |            1 |

Stable IDs are SHA-256-derived from each exact URL. The 19 public GPT records are evidence only: every row is intentionally excluded from copying and maps only to the Kova assistant-directory template family. No third-party name, creator, prompt, identifier, or assistant content was added to the Kova registry.

## Dispositions and family interpretation

| Disposition                   | Exact rows |
| ----------------------------- | ---------: |
| `implemented_existing`        |          2 |
| `implemented_new`             |         21 |
| `dynamic_template`            |          8 |
| `redirected`                  |         10 |
| `intentionally_excluded`      |         86 |
| `requires_admin_content`      |          4 |
| `requires_legal_review`       |          1 |
| `blocked_external_dependency` |          0 |

The 35 OpenAI sitemap-section rows are treated as families, never as pages named after sitemap sections. Their Kova template mappings are: product 3, company 3, developer 1, use case 1, app category 8, publishing 10, trust 3, policy 1, safety 1, and 4 intentionally excluded OpenAI-specific structures/programs/products.

All 63 ChatGPT locale roots map to the localization architecture and remain intentionally excluded/noindex because English is the only reviewed locale. Arabic direction resolves to RTL in the architecture without making Arabic available or indexable. Ten language-pair translation rows consolidate into the single `/translate` intent surface instead of creating doorway pages.

## Individual review of the 105 noindex routes

`content-review-manifest.json` contains exactly 105 unique route decisions. Each record includes its template family, rendered H1, main-content word count, duplicate-content similarity matches, unique-content score, capability references, CTA and runtime result, legal/admin state, developer verification state, decision, and reason.

| Content-review result                                   |         Exact result |
| ------------------------------------------------------- | -------------------: |
| Routes reviewed                                         |            105 / 105 |
| Promoted to indexable                                   |                    0 |
| Remaining noindex                                       |                  105 |
| Kova routes consolidated in this pass                   |                    0 |
| Kova redirects added in this pass                       |                    0 |
| Kova pages removed in this pass                         |                    0 |
| Source translation intents consolidated                 | 10 into `/translate` |
| Legal-review routes                                     |                    8 |
| Administrator-content routes                            |                    3 |
| Developer pages reviewed                                |                   19 |
| Developer pages verified for a public endpoint contract |                    0 |
| Developer pages kept noindex                            |                   19 |

No page was promoted merely to increase sitemap size. The shared-template pages remain too concise or duplicative for indexing, legal/admin review remains unresolved where marked, and developer pages do not yet describe a verified public Kova developer API contract. Authenticated API-key, billing, and usage surfaces remain workspace redirects outside the 105 public-page review.

## Product and privacy corrections

The Maps surface is now a noindex preview that requests no device location and makes no provider call. It tells users to verify routes and availability with an authoritative map provider. The unwired reference-image picker was removed from Images so the UI no longer implies that a selected file will be submitted. IME composition is explicitly protected in the image prompt.

Operational analytics now subscribes and flushes only after authentication resolves to a signed-in user. Public marketing routes therefore do not make the previous unauthorized analytics server-function request. Share, canvas, projects, library, billing, and API-key boundaries remain unchanged.

## Architecture decisions and quality gates

The 11 stale unit-test conflicts were resolved through the evidence table in `architecture-decisions.md`: fixed managed/direct provider endpoints remain allowed while environment URL escape hatches remain prohibited; full-duplex Voice remains disabled while same-origin dictation is distinct; current server output ceilings are asserted; the dead image attachment UI was removed; selector delegation is tested at its actual owner; both declared lockfiles remain; and checked-in email dependencies remain pinned.

Fast Refresh utilities/constants were moved to their existing dedicated modules, hook dependencies were corrected, and unstable derived collections were memoized. Repository lint now reports zero errors and zero warnings. The complete unit suite reports 295 passing tests and zero failures after the new snapshot/content-review tests are included.

## Runtime, metadata, sitemap, and visual QA

The historical 114-route manifest remains exact for the original public-route commit: 98 static files and 16 dynamic templates. This pass adds one noindex Maps preview, for 115 route files in the audited ecosystem. The established sitemap remains exactly 24 entries; no reviewed noindex route was promoted.

The production-like preview crawl records 119/119 passing cases: every historical route template, the Maps preview, and invalid app, assistant, share, and canvas identifiers. It contains zero HTTP 500 responses, all unpublished publishing details return 404, Maps returns 200/noindex, and private identifiers fail closed.

The visual matrix records 12 screenshots: light and dark at 320, 390, 768, 1280, 1440, and 1920 pixels. It reports zero overflow cases, zero H1 failures, and zero unexpected console errors after public analytics was gated. English UI and Arabic RTL direction architecture are tested while Arabic remains unavailable and noindex.

## Live revalidation requirement

All 132 rows require live revalidation because the supplied lists are a dated snapshot. Snapshot parity must not be represented as current live parity after the source sites change. Re-running the live collector must compare rather than silently overwrite this evidence.
